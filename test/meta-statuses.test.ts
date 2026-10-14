// KRIONIX: focused tests for the Meta Cloud API patches (see KRIONIX_META_PATCH.md).
// Run with: npx tsx --test test/meta-statuses.test.ts
import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { Events } from '@api/types/wa.types';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const PHONE_NUMBER_ID = '123';
const KNOWN_IDS = ['wamid.KNOWN', 'wamid.STATUS1', 'wamid.SENT_SEQ'];

function buildService(knownIds: string[] = KNOWN_IDS) {
  const webhooks: { event: string; data: any }[] = [];
  const updates: any[] = [];
  const errors: any[] = [];

  const svc: any = Object.create(BusinessStartupService.prototype);
  Object.defineProperty(svc, 'instanceId', { value: 'instance-test' });
  Object.defineProperty(svc, 'logger', {
    value: { error: (e: any) => errors.push(e), log: () => {}, verbose: () => {}, warn: () => {}, info: () => {} },
    writable: true,
  });
  Object.defineProperty(svc, 'localChatwoot', { value: {} });
  svc.phoneNumber = PHONE_NUMBER_ID;
  svc.configService = { get: () => ({ ENABLED: false }) };
  svc.sendDataWebhook = (event: string, data: any) => webhooks.push({ event, data });
  svc.prismaRepository = {
    message: {
      findFirst: async ({ where }: any) =>
        knownIds.includes(where.key.equals) ? { id: `db-${where.key.equals}`, webhookUrl: null } : null,
    },
    messageUpdate: { create: async ({ data }: any) => updates.push(data) },
  };

  return {
    svc,
    webhooks,
    updates,
    errors,
    handle: (received: any) => svc.messageHandle(received, {}, {}) as Promise<void>,
  };
}

const statusUpdates = (webhooks: { event: string; data: any }[]) =>
  webhooks.filter((w) => w.event === Events.MESSAGES_UPDATE).map((w) => w.data);

describe('Meta Cloud API statuses', () => {
  it('TEST 1: contacts without profile does not crash and the status is processed', async () => {
    const t = buildService();
    await t.handle({
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      contacts: [{ wa_id: '593999999999' }],
      statuses: [{ id: 'wamid.STATUS1', status: 'delivered', recipient_id: '593999999999', timestamp: '123456' }],
    });

    assert.deepEqual(t.errors, []);
    const updates = statusUpdates(t.webhooks);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].keyId, 'wamid.STATUS1');
    assert.equal(updates[0].status, 'DELIVERED');
    assert.equal(t.updates.length, 1);
  });

  it('TEST 2: contacts with profile keeps pushName = profile.name', async () => {
    const t = buildService();
    let messageRaw: any;
    Object.defineProperty(t.svc, 'localSettings', { value: {} });
    // messageHandle logs messageRaw right before telemetry/chatbot/DB side effects; capture it and stop there
    t.svc.logger = {
      error: () => {},
      log: (value: any) => {
        messageRaw = value;
        throw new Error('stop-after-messageRaw');
      },
    };

    await t.handle({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      contacts: [{ profile: { name: 'Carlos' }, wa_id: '593999999999' }],
      messages: [{ id: 'wamid.IN1', from: '593999999999', timestamp: '123456', type: 'reaction', reaction: {} }],
    });

    assert.equal(messageRaw?.pushName, 'Carlos');
    assert.equal(messageRaw?.key?.id, 'wamid.IN1');
  });

  it('TEST 3 / FASE 22: unknown wamid in a batch does not stop the following statuses', async () => {
    const t = buildService();
    await t.handle({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [
        { id: 'wamid.UNKNOWN', status: 'delivered' },
        { id: 'wamid.KNOWN', status: 'read' },
      ],
    });

    // meta.2: the unknown wamid is still emitted (consumers match by keyId) but not persisted
    const updates = statusUpdates(t.webhooks);
    assert.deepEqual(
      updates.map((u) => [u.keyId, u.status, u.messageId]),
      [
        ['wamid.UNKNOWN', 'DELIVERED', undefined],
        ['wamid.KNOWN', 'READ', 'db-wamid.KNOWN'],
      ],
    );
    assert.deepEqual(
      t.updates.map((u) => u.keyId),
      ['wamid.KNOWN'],
    );
  });

  it('a failing status in a batch does not stop the following statuses', async () => {
    const t = buildService();
    const original = t.svc.prismaRepository.messageUpdate.create;
    t.svc.prismaRepository.messageUpdate.create = async (args: any) => {
      if (args.data.keyId === 'wamid.STATUS1') throw new Error('db down');
      return original(args);
    };
    await t.handle({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [
        { id: 'wamid.STATUS1', status: 'delivered' },
        { id: 'wamid.KNOWN', status: 'read' },
      ],
    });

    assert.deepEqual(
      t.updates.map((u) => u.keyId),
      ['wamid.KNOWN'],
    );
    assert.equal(t.errors.length, 1);
  });

  it('TEST 4: sent -> delivered -> read each emit MESSAGES_UPDATE', async () => {
    const t = buildService();
    for (const status of ['sent', 'delivered', 'read']) {
      await t.handle({
        metadata: { phone_number_id: PHONE_NUMBER_ID },
        contacts: [{ wa_id: '593999999999' }],
        statuses: [{ id: 'wamid.SENT_SEQ', status, recipient_id: '593999999999', timestamp: '1' }],
      });
    }
    assert.deepEqual(
      statusUpdates(t.webhooks).map((u) => u.status),
      ['SENT', 'DELIVERED', 'READ'],
    );
  });

  it('TEST 5: failed keeps the existing behaviour (MESSAGES_UPDATE with FAILED)', async () => {
    const t = buildService();
    await t.handle({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [{ id: 'wamid.KNOWN', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }],
    });
    const updates = statusUpdates(t.webhooks);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, 'FAILED');
  });
});

const PRESIGNED = (file: string) =>
  `https://bucket.s3.amazonaws.com/media/${file}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20260927&X-Amz-Signature=abc123`;

describe('Meta Cloud API media with presigned URLs', () => {
  const prepare = (media: any) => buildService().svc.prepareMediaMessage(media);

  it('uses the mimetype sent in the payload', async () => {
    const m = await prepare({ mediatype: 'document', media: PRESIGNED('x.bin'), fileName: 'f.pdf', mimetype: 'application/pdf' });
    assert.equal(m.mimetype, 'application/pdf');
    assert.equal(m.type, 'link');
    assert.equal(m.id, PRESIGNED('x.bin'));
  });

  it('detects mimetype from the URL path, ignoring the query string', async () => {
    assert.equal((await prepare({ mediatype: 'image', media: PRESIGNED('photo.jpg') })).mimetype, 'image/jpeg');
    assert.equal((await prepare({ mediatype: 'video', media: PRESIGNED('clip.mp4') })).mimetype, 'video/mp4');
  });

  it('falls back to fileName and then application/octet-stream', async () => {
    const byName = await prepare({ mediatype: 'document', media: PRESIGNED('blob'), fileName: 'report.pdf' });
    assert.equal(byName.mimetype, 'application/pdf');
    const unknown = await prepare({ mediatype: 'document', media: PRESIGNED('blob'), fileName: 'noext' });
    assert.equal(unknown.mimetype, 'application/octet-stream');
  });

  it('document without fileName derives it from the URL path', async () => {
    const m = await prepare({ mediatype: 'document', media: PRESIGNED('invoice-42.pdf') });
    assert.equal(m.fileName, 'invoice-42');
    assert.equal(m.mimetype, 'application/pdf');
  });

  it('sendMessageWithTyping builds the Cloud API payload for an image without crashing', async () => {
    const t = buildService();
    let sent: any;
    t.svc.post = async (content: any) => {
      sent = content;
      return { error_data: 'stop-after-post' }; // makes sendMessageWithTyping return before DB side effects
    };
    Object.defineProperty(t.svc, 'instance', { value: { name: 'test' } });
    const media = await t.svc.prepareMediaMessage({ mediatype: 'image', media: PRESIGNED('photo.jpg'), caption: 'hi' });
    await t.svc.sendMessageWithTyping('593999999999', { ...media }, {});
    assert.equal(sent?.type, 'image');
    assert.equal(sent?.image?.link, PRESIGNED('photo.jpg'));
    assert.equal(sent?.image?.caption, 'hi');
    assert.equal(sent?.image?.filename, undefined);
  });
});

// BadRequestException throws a plain object: { status: 400, error, message: [..] }
const badRequest = (pattern: RegExp) => (err: any) => err?.status === 400 && pattern.test(JSON.stringify(err.message));

describe('Meta Cloud API markMessageAsRead (upstream #2741)', () => {
  const build = (postResult: any) => {
    const t = buildService();
    const calls: any[] = [];
    Object.defineProperty(t.svc, 'token', { value: 'test-token' });
    Object.defineProperty(t.svc, 'number', { value: PHONE_NUMBER_ID });
    t.svc.post = async (content: any, params: string) => {
      calls.push({ content, params });
      return postResult;
    };
    return { svc: t.svc, calls };
  };

  it('sends status=read for each wamid', async () => {
    const { svc, calls } = build({ success: true });
    const res = await svc.markMessageAsRead({ readMessages: [{ id: 'wamid.A' }, { id: 'wamid.B' }] });
    assert.deepEqual(res, { message: 'Messages marked as read', read: 'success' });
    assert.deepEqual(
      calls.map((c) => [c.params, c.content.status, c.content.message_id]),
      [
        ['messages', 'read', 'wamid.A'],
        ['messages', 'read', 'wamid.B'],
      ],
    );
  });

  it('bubbles Meta errors as BadRequest', async () => {
    const { svc } = build({ message: 'Invalid parameter', code: 100 });
    await assert.rejects(svc.markMessageAsRead({ readMessages: [{ id: 'wamid.A' }] }), badRequest(/Invalid parameter/));
  });

  it('rejects empty readMessages', async () => {
    const { svc } = build({ success: true });
    await assert.rejects(svc.markMessageAsRead({ readMessages: [] }), badRequest(/at least one/));
  });
});

describe('Meta Cloud API concurrency and batches (community port)', () => {
  // Stubs messageHandle side effects: captures the messageRaw logged right before telemetry/chatbot/DB work
  const buildInbound = () => {
    const t = buildService();
    const raws: any[] = [];
    Object.defineProperty(t.svc, 'localSettings', { value: {} });
    t.svc.loadChatwoot = () => {};
    t.svc.findSettings = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5)); // force interleaving between webhooks
      return {};
    };
    t.svc.logger = {
      error: () => {},
      warn: () => {},
      log: (value: any) => {
        if (value?.key) {
          raws.push(value);
          throw new Error('stop-after-messageRaw');
        }
      },
    };
    return { t, raws };
  };

  const inbound = (from: string, id: string, name: string) => ({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name }, wa_id: from }],
              messages: [{ id, from, timestamp: '1', type: 'reaction', reaction: {} }],
            },
          },
        ],
      },
    ],
  });

  it('concurrent webhooks keep each message in its own chat (no shared phoneNumber race)', async () => {
    const { t, raws } = buildInbound();
    await Promise.all([
      t.svc.connectToWhatsapp(inbound('593900000001', 'wamid.A', 'Ana')),
      t.svc.connectToWhatsapp(inbound('593900000002', 'wamid.B', 'Beto')),
    ]);
    const byId = Object.fromEntries(raws.map((r) => [r.key.id, r]));
    assert.equal(byId['wamid.A'].key.remoteJid, '593900000001@s.whatsapp.net');
    assert.equal(byId['wamid.A'].pushName, 'Ana');
    assert.equal(byId['wamid.B'].key.remoteJid, '593900000002@s.whatsapp.net');
    assert.equal(byId['wamid.B'].pushName, 'Beto');
  });

  it('processes every message of a batch with its own contact', async () => {
    const { t, raws } = buildInbound();
    await t.svc.eventHandler({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      contacts: [
        { profile: { name: 'Ana' }, wa_id: '593900000001' },
        { profile: { name: 'Beto' }, wa_id: '593900000002' },
      ],
      messages: [
        { id: 'wamid.1', from: '593900000001', timestamp: '1', type: 'reaction', reaction: {} },
        { id: 'wamid.2', from: '593900000002', timestamp: '1', type: 'reaction', reaction: {} },
      ],
    });
    assert.deepEqual(
      raws.map((r) => [r.key.id, r.key.remoteJid, r.pushName]),
      [
        ['wamid.1', '593900000001@s.whatsapp.net', 'Ana'],
        ['wamid.2', '593900000002@s.whatsapp.net', 'Beto'],
      ],
    );
  });

  it('status uses recipient_id as remoteJid, fromMe=true, and forwards Meta errors on FAILED', async () => {
    const t = buildService();
    await t.handle({
      metadata: { phone_number_id: PHONE_NUMBER_ID, display_phone_number: '593222222222' },
      statuses: [
        {
          id: 'wamid.KNOWN',
          status: 'failed',
          recipient_id: '593999999999',
          errors: [{ code: 131047, title: 'Re-engagement message' }],
        },
      ],
    });
    const [update] = statusUpdates(t.webhooks);
    assert.equal(update.remoteJid, '593999999999@s.whatsapp.net');
    assert.equal(update.fromMe, true);
    assert.equal(update.errors?.[0]?.code, 131047);
    assert.equal(t.updates[0].errors, undefined, 'errors are not persisted (no column)');
  });
});

// KRIONIX Phase 2A (Nix360 envía directo por Graph): los wamid de esos envíos NO existen en la
// tabla Message de Evolution. Sus estados deben llegar igual a Nix360 (que empareja por keyId),
// sin crear mensajes ficticios y sin cortar el lote. Casos A–G del plan de migración.
describe('Meta Direct outbound: statuses of wamids unknown to Evolution', () => {
  const batch = (statuses: any[]) => ({ metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses });

  it('A: known wamid keeps the current behaviour (emit with messageId + persist MessageUpdate)', async () => {
    const t = buildService();
    await t.handle(batch([{ id: 'wamid.KNOWN', status: 'delivered', recipient_id: '593999999999' }]));
    const [update] = statusUpdates(t.webhooks);
    assert.equal(update.keyId, 'wamid.KNOWN');
    assert.equal(update.messageId, 'db-wamid.KNOWN');
    assert.equal(update.status, 'DELIVERED');
    assert.deepEqual(
      t.updates.map((u) => [u.keyId, u.status]),
      [['wamid.KNOWN', 'DELIVERED']],
    );
  });

  it('B: unknown wamid emits MESSAGES_UPDATE (keyId, status, remoteJid) without persisting or faking a Message', async () => {
    const t = buildService();
    let messageCreates = 0;
    t.svc.prismaRepository.message.create = async () => {
      messageCreates += 1;
    };
    await t.handle(batch([{ id: 'wamid.DIRECT', status: 'sent', recipient_id: '593999999999', timestamp: '1700000000' }]));
    const updates = statusUpdates(t.webhooks);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].keyId, 'wamid.DIRECT');
    assert.equal(updates[0].status, 'SENT');
    assert.equal(updates[0].remoteJid, '593999999999@s.whatsapp.net');
    assert.equal(updates[0].fromMe, true);
    assert.equal(updates[0].messageId, undefined);
    assert.deepEqual(t.updates, [], 'MessageUpdate has a FK to Message: unknown wamids are not persisted');
    assert.equal(messageCreates, 0, 'no fake Message rows');
  });

  it('C: unknown + known in one batch: both are processed', async () => {
    const t = buildService();
    await t.handle(
      batch([
        { id: 'wamid.DIRECT', status: 'delivered' },
        { id: 'wamid.KNOWN', status: 'delivered' },
      ]),
    );
    assert.deepEqual(
      statusUpdates(t.webhooks).map((u) => u.keyId),
      ['wamid.DIRECT', 'wamid.KNOWN'],
    );
  });

  it('D: known + unknown + known: the unknown one never stops the batch', async () => {
    const t = buildService();
    await t.handle(
      batch([
        { id: 'wamid.KNOWN', status: 'read' },
        { id: 'wamid.DIRECT', status: 'read' },
        { id: 'wamid.STATUS1', status: 'read' },
      ]),
    );
    assert.deepEqual(
      statusUpdates(t.webhooks).map((u) => [u.keyId, u.status]),
      [
        ['wamid.KNOWN', 'READ'],
        ['wamid.DIRECT', 'READ'],
        ['wamid.STATUS1', 'READ'],
      ],
    );
    assert.deepEqual(
      t.updates.map((u) => u.keyId),
      ['wamid.KNOWN', 'wamid.STATUS1'],
    );
  });

  it('E: sent/delivered/read/failed map the same for unknown wamids; FAILED keeps Meta errors', async () => {
    const t = buildService();
    for (const status of ['sent', 'delivered', 'read']) {
      await t.handle(batch([{ id: 'wamid.DIRECT', status, recipient_id: '593999999999' }]));
    }
    await t.handle(
      batch([
        {
          id: 'wamid.DIRECT_FAIL',
          status: 'failed',
          recipient_id: '593999999999',
          errors: [{ code: 131026, title: 'Message undeliverable' }],
        },
      ]),
    );
    const updates = statusUpdates(t.webhooks);
    assert.deepEqual(
      updates.map((u) => u.status),
      ['SENT', 'DELIVERED', 'READ', 'FAILED'],
    );
    assert.equal(updates[3].keyId, 'wamid.DIRECT_FAIL');
    assert.equal(updates[3].errors?.[0]?.code, 131026);
  });

  it('F: a known wamid emits exactly one MESSAGES_UPDATE per status (no duplicate webhooks)', async () => {
    const t = buildService();
    await t.handle(batch([{ id: 'wamid.KNOWN', status: 'delivered' }]));
    await t.handle(batch([{ id: 'wamid.DIRECT', status: 'delivered' }]));
    const updates = statusUpdates(t.webhooks);
    assert.equal(updates.filter((u) => u.keyId === 'wamid.KNOWN').length, 1);
    assert.equal(updates.filter((u) => u.keyId === 'wamid.DIRECT').length, 1);
  });

  it('G: statuses do not touch MESSAGES_UPSERT and CALL events are still relayed in the same webhook', async () => {
    const t = buildService();
    t.svc.findSettings = async () => ({});
    await t.svc.eventHandler({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [{ id: 'wamid.DIRECT', status: 'delivered', recipient_id: '593999999999' }],
      calls: [{ id: 'wacid.TEST', event: 'connect', from: '593999999999', direction: 'USER_INITIATED' }],
    });
    const events = t.webhooks.map((w) => w.event);
    assert.equal(events.filter((e) => e === Events.MESSAGES_UPDATE).length, 1);
    assert.equal(events.filter((e) => e === Events.CALL).length, 1);
    assert.equal(events.filter((e) => e === Events.MESSAGES_UPSERT).length, 0);
    const call = t.webhooks.find((w) => w.event === Events.CALL)!.data;
    assert.equal(call.callId, 'wacid.TEST');
  });
});
