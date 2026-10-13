// KRIONIX: SDP redaction in logs. Run: npx tsx --test test/logger-redaction.test.ts
import { Logger } from '@config/logger.config';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const redact = (v: any) => (Logger as any).redactSdp(v);

describe('Logger.redactSdp', () => {
  it('redacts nested sdp strings without mutating the original', () => {
    const payload = { event: 'call', data: { callId: 'wacid.1', sdp: 'v=0 a=ice-pwd:secret', list: [{ sdp: 'x' }] } };
    const out = redact(payload);
    assert.equal(out.data.sdp, '[redacted]');
    assert.equal(out.data.list[0].sdp, '[redacted]');
    assert.equal(out.data.callId, 'wacid.1');
    assert.equal(payload.data.sdp, 'v=0 a=ice-pwd:secret', 'original must stay intact (it is still sent to the webhook)');
  });

  it('returns the same reference when there is nothing to redact', () => {
    const payload = { event: 'messages.upsert', data: { key: { id: '1' } } };
    assert.equal(redact(payload), payload);
    const buf = Buffer.alloc(1024);
    assert.equal(redact(buf), buf);
    assert.equal(redact('plain string'), 'plain string');
  });
});
