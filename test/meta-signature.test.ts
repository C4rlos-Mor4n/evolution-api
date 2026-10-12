// KRIONIX: X-Hub-Signature-256 verification for /webhook/meta. Run: npx tsx --test test/meta-signature.test.ts
import { verifyMetaSignature } from '@api/integrations/channel/meta/meta.signature';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('verifyMetaSignature', () => {
  it('is skipped when off or no secret configured', () => {
    assert.equal(verifyMetaSignature({ APP_SECRETS: ['s'], SIGNATURE_MODE: 'off' }, body, sign('s')), 'skipped');
    assert.equal(verifyMetaSignature({ APP_SECRETS: [], SIGNATURE_MODE: 'log' }, body, undefined), 'skipped');
  });

  it('fails closed when enforce is set without any secret (misconfiguration)', () => {
    assert.equal(verifyMetaSignature({ APP_SECRETS: [], SIGNATURE_MODE: 'enforce' }, body, sign('x')), 'invalid');
  });

  it('accepts a valid signature from any configured app secret', () => {
    const config = { APP_SECRETS: ['app-a', 'app-b'], SIGNATURE_MODE: 'enforce' as const };
    assert.equal(verifyMetaSignature(config, body, sign('app-a')), 'valid');
    assert.equal(verifyMetaSignature(config, body, sign('app-b')), 'valid');
  });

  it('rejects wrong secret, tampered body and missing header', () => {
    const config = { APP_SECRETS: ['app-a'], SIGNATURE_MODE: 'enforce' as const };
    assert.equal(verifyMetaSignature(config, body, sign('other')), 'invalid');
    assert.equal(verifyMetaSignature(config, Buffer.from('{}'), sign('app-a')), 'invalid');
    assert.equal(verifyMetaSignature(config, body, undefined), 'missing');
    assert.equal(verifyMetaSignature(config, undefined, sign('app-a')), 'missing');
    assert.equal(verifyMetaSignature(config, body, 'sha256=zz'), 'invalid');
  });
});
