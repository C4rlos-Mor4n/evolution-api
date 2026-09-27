// KRIONIX: focused tests for the Meta Cloud API status webhook fixes (see KRIONIX_META_PATCH.md).
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

    const updates = statusUpdates(t.webhooks);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].keyId, 'wamid.KNOWN');
    assert.equal(updates[0].status, 'READ');
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
