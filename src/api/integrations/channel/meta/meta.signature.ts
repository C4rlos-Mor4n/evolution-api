import { WaBusiness } from '@config/env.config';
import { createHmac, timingSafeEqual } from 'crypto';

export type MetaSignatureResult = 'skipped' | 'valid' | 'invalid' | 'missing';

/**
 * Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw request body with the App Secret).
 * Several secrets are accepted so more than one Meta app can deliver to the same server.
 */
export function verifyMetaSignature(
  config: Pick<WaBusiness, 'APP_SECRETS' | 'SIGNATURE_MODE'>,
  rawBody: Buffer | undefined,
  signatureHeader: string | string[] | undefined,
): MetaSignatureResult {
  if (config.SIGNATURE_MODE === 'off') {
    return 'skipped';
  }

  // enforce/log without any secret is a misconfiguration: never treat it as a valid signature
  if (config.APP_SECRETS.length === 0) {
    return config.SIGNATURE_MODE === 'enforce' ? 'invalid' : 'skipped';
  }

  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header || !header.startsWith('sha256=') || !rawBody) {
    return 'missing';
  }

  const received = Buffer.from(header.slice('sha256='.length), 'hex');

  const matches = config.APP_SECRETS.some((secret) => {
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    return expected.length === received.length && timingSafeEqual(expected, received);
  });

  return matches ? 'valid' : 'invalid';
}
