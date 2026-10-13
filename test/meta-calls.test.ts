// KRIONIX: WhatsApp Cloud API Calling (user-initiated calls). Run: npx tsx --test test/meta-calls.test.ts
import '@api/server.module';

import { CallController } from '@api/controllers/call.controller';
import { BusinessStartupService } from '@api/integrations/channel/meta/whatsapp.business.service';
import { Events } from '@api/types/wa.types';
import axios from 'axios';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const SDP_OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const SDP_ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

function buildService(postResult: any = { messaging_product: 'whatsapp', success: true }) {
  const webhooks: { event: string; data: any }[] = [];
  const posts: { content: any; params: string }[] = [];
  const svc: any = Object.create(BusinessStartupService.prototype);
  Object.defineProperty(svc, 'instanceId', { value: 'instance-test' });
  Object.defineProperty(svc, 'logger', {
    value: { error: () => {}, log: () => {}, warn: () => {}, verbose: () => {} },
    writable: true,
  });
  Object.defineProperty(svc, 'token', { value: 'test-token' });
  Object.defineProperty(svc, 'number', { value: '123' });
  svc.sendDataWebhook = (event: string, data: any) => webhooks.push({ event, data });
  svc.configService = { get: () => ({ URL: 'https://graph.test', VERSION: 'v23.0' }) };
  svc.callingGraphRequest = async (_method: string, params: string, content: any) => {
    posts.push({ content, params });
    return postResult;
  };
  return { svc, webhooks, posts };
}

const calls = (webhooks: { event: string; data: any }[]) => webhooks.filter((w) => w.event === Events.CALL).map((w) => w.data);

describe('Cloud API calls webhook -> CALL event', () => {
  it('relays an incoming call (connect) with the SDP offer and caller info', () => {
    const t = buildService();
    t.svc.cloudCallsHandle({
      metadata: { phone_number_id: '123', display_phone_number: '593222222222' },
      contacts: [{ profile: { name: 'Ana' }, wa_id: '593900000001' }],
      calls: [
        {
          id: 'wacid.ABC',
          from: '593900000001',
          to: '593222222222',
          event: 'connect',
          timestamp: '1760000000',
          session: { sdp_type: 'offer', sdp: SDP_OFFER },
        },
      ],
    });
    const [call] = calls(t.webhooks);
    assert.equal(call.provider, 'cloud_api');
    assert.equal(call.callId, 'wacid.ABC');
    assert.equal(call.event, 'connect');
    assert.equal(call.direction, 'USER_INITIATED');
    assert.equal(call.fromJid, '593900000001@s.whatsapp.net');
    assert.equal(call.pushName, 'Ana');
    assert.equal(call.sdpType, 'offer');
    assert.equal(call.sdp, SDP_OFFER);
    assert.equal(call.timestamp, 1760000000);
  });

  it('relays terminate with status, duration and errors', () => {
    const t = buildService();
    t.svc.cloudCallsHandle({
      metadata: { phone_number_id: '123' },
      calls: [
        {
          id: 'wacid.ABC',
          from: '593900000001',
          event: 'terminate',
          direction: 'USER_INITIATED',
          status: 'COMPLETED',
          start_time: '1760000005',
          end_time: '1760000065',
          duration: 60,
          biz_opaque_callback_data: 'ticket-42',
        },
        { id: 'wacid.FAIL', event: 'terminate', status: 'FAILED', errors: [{ code: 138006, message: 'ICE' }] },
      ],
    });
    const [ok, failed] = calls(t.webhooks);
    assert.equal(ok.status, 'COMPLETED');
    assert.equal(ok.duration, 60);
    assert.equal(ok.startTime, 1760000005);
    assert.equal(ok.bizOpaqueCallbackData, 'ticket-42');
    assert.equal(ok.sdp, undefined);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.errors[0].code, 138006);
  });

  it('eventHandler routes calls without touching messages/statuses', async () => {
    const t = buildService();
    t.svc.findSettings = async () => ({});
    let messageHandleCalls = 0;
    t.svc.messageHandle = async () => {
      messageHandleCalls++;
    };
    await t.svc.eventHandler({
      metadata: { phone_number_id: '123' },
      calls: [{ id: 'wacid.X', from: '593900000001', event: 'connect', session: { sdp_type: 'offer', sdp: SDP_OFFER } }],
    });
    assert.equal(messageHandleCalls, 0);
    assert.equal(calls(t.webhooks).length, 1);
  });
});

describe('Cloud API call actions', () => {
  it('accept sends the SDP answer and biz_opaque_callback_data to /calls', async () => {
    const t = buildService();
    const res = await t.svc.cloudCallAction('accept', {
      callId: 'wacid.ABC',
      sdp: SDP_ANSWER,
      bizOpaqueCallbackData: 'ticket-42',
    });
    assert.deepEqual(res, { success: true, callId: 'wacid.ABC', action: 'accept' });
    assert.equal(t.posts[0].params, 'calls');
    assert.deepEqual(t.posts[0].content, {
      messaging_product: 'whatsapp',
      call_id: 'wacid.ABC',
      action: 'accept',
      session: { sdp_type: 'answer', sdp: SDP_ANSWER },
      biz_opaque_callback_data: 'ticket-42',
    });
  });

  it('pre_accept sends the SDP answer; reject/terminate send no session', async () => {
    const t = buildService();
    await t.svc.cloudCallAction('pre_accept', { callId: 'wacid.ABC', sdp: SDP_ANSWER });
    await t.svc.cloudCallAction('reject', { callId: 'wacid.ABC' });
    await t.svc.cloudCallAction('terminate', { callId: 'wacid.ABC', sdp: SDP_ANSWER });
    assert.deepEqual(
      t.posts.map((p) => [p.content.action, p.content.session?.sdp_type ?? null]),
      [
        ['pre_accept', 'answer'],
        ['reject', null],
        ['terminate', null],
      ],
    );
  });

  it('requires an SDP for accept and surfaces Meta errors as 400', async () => {
    const t = buildService();
    await assert.rejects(
      t.svc.cloudCallAction('accept', { callId: 'wacid.ABC' }),
      (e: any) => e.status === 400 && /sdp/.test(JSON.stringify(e.message)),
    );
    const failing = buildService({ message: 'Call not found', code: 138000 });
    await assert.rejects(
      failing.svc.cloudCallAction('reject', { callId: 'wacid.GONE' }),
      (e: any) => e.status === 400 && /Call not found/.test(JSON.stringify(e.message)),
    );
  });

  it('setCloudCallSettings posts { calling } to /settings', async () => {
    const t = buildService({ success: true });
    const res = await t.svc.setCloudCallSettings({ calling: { status: 'ENABLED', call_icon_visibility: 'DEFAULT' } });
    assert.deepEqual(res, { success: true });
    assert.equal(t.posts[0].params, 'settings');
    assert.deepEqual(t.posts[0].content, { calling: { status: 'ENABLED', call_icon_visibility: 'DEFAULT' } });
  });
});

describe('CallController', () => {
  it('rejects Cloud API call actions on non WHATSAPP-BUSINESS instances', async () => {
    const controller = new CallController({ waInstances: { baileys: { offerCall: async () => ({}) } } } as any);
    await assert.rejects(
      controller.cloudCallAction({ instanceName: 'baileys' } as any, 'accept', { callId: 'x', sdp: 'y' }),
      (e: any) => e.status === 400 && /WHATSAPP-BUSINESS/.test(JSON.stringify(e.message)),
    );
  });
});

describe('Cloud API calling Graph request (timeout and error mapping)', () => {
  const realRequest = axios.request;
  const withAxios = async (impl: any, fn: (svc: any, seen: any[]) => Promise<void>) => {
    const seen: any[] = [];
    (axios as any).request = async (cfg: any) => {
      seen.push(cfg);
      return impl(cfg);
    };
    try {
      const svc: any = Object.create(BusinessStartupService.prototype);
      Object.defineProperty(svc, 'token', { value: 'test-token' });
      Object.defineProperty(svc, 'number', { value: '123' });
      svc.configService = { get: () => ({ URL: 'https://graph.test', VERSION: 'v23.0' }) };
      await fn(svc, seen);
    } finally {
      (axios as any).request = realRequest;
    }
  };

  it('posts to <URL>/<VERSION>/<number>/calls with a timeout', async () => {
    await withAxios(
      () => ({ data: { success: true } }),
      async (svc, seen) => {
        await svc.callingGraphRequest('POST', 'calls', { a: 1 });
        assert.equal(seen[0].url, 'https://graph.test/v23.0/123/calls');
        assert.equal(seen[0].timeout, 15000);
        assert.equal(seen[0].headers.Authorization, 'Bearer test-token');
      },
    );
  });

  it('maps Meta 4xx to 400, 5xx and timeouts to 500', async () => {
    const fail = (response: any, message = 'boom') => () => {
      throw Object.assign(new Error(message), { response });
    };
    await withAxios(fail({ status: 401, data: { error: { message: 'Invalid OAuth access token', code: 190 } } }), (svc) =>
      assert.rejects(
        svc.callingGraphRequest('POST', 'calls', {}),
        (e: any) => e.status === 400 && /HTTP 401, code 190/.test(JSON.stringify(e.message)),
      ),
    );
    await withAxios(fail({ status: 503, data: {} }), (svc) =>
      assert.rejects(svc.callingGraphRequest('POST', 'calls', {}), (e: any) => e.status === 500),
    );
    await withAxios(fail(undefined, 'timeout of 15000ms exceeded'), (svc) =>
      assert.rejects(
        svc.callingGraphRequest('POST', 'calls', {}),
        (e: any) => e.status === 500 && /timeout of 15000ms/.test(JSON.stringify(e.message)),
      ),
    );
  });
});

describe('Cloud API calls privacy', () => {
  it('never logs the SDP of a call webhook and does not borrow another contact name', async () => {
    const t = buildService();
    const logged: string[] = [];
    t.svc.logger = { error: () => {}, warn: () => {}, verbose: () => {}, log: (v: any) => logged.push(String(v)) };
    t.svc.findSettings = async () => ({});
    t.svc.messageHandle = async () => {};
    await t.svc.eventHandler({
      metadata: { phone_number_id: '123' },
      contacts: [{ profile: { name: 'Otro' }, wa_id: '593900000099' }],
      calls: [{ id: 'wacid.P', from: '593900000001', event: 'connect', session: { sdp_type: 'offer', sdp: SDP_OFFER } }],
    });
    assert.ok(!logged.some((l) => l.includes('UDP/TLS/RTP/SAVPF')), 'SDP leaked to logs');
    assert.ok(logged.some((l) => l.includes('[redacted]')));
    assert.equal(calls(t.webhooks)[0].pushName, undefined);
    assert.equal(calls(t.webhooks)[0].sdp, SDP_OFFER, 'the webhook itself still carries the SDP');
  });
});
