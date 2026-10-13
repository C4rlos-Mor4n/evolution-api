import { WaBusiness } from '@config/env.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import axios from 'axios';

const VALIDATION_TIMEOUT_MS = 15_000;

/**
 * Checks a Meta access token against the Graph API: it must be valid AND have access to the given
 * phone number id (GET /<PHONE_NUMBER_ID>?fields=id). Throws without ever including the token.
 */
export async function validateMetaAccessToken(
  config: Pick<WaBusiness, 'URL' | 'VERSION'>,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  let data: any;
  try {
    ({ data } = await axios.get(`${config.URL}/${config.VERSION}/${encodeURIComponent(phoneNumberId)}`, {
      params: { fields: 'id' },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: VALIDATION_TIMEOUT_MS,
    }));
  } catch (error) {
    // Build the message by hand: axios errors carry the request config (Authorization header).
    const status: number | undefined = error?.response?.status;
    const metaError = error?.response?.data?.error;
    const detail = metaError?.message || 'no response';

    if (!error?.response) {
      throw new InternalServerErrorException(
        `Meta Graph API unreachable while validating the token: ${error?.code ?? 'error'}`,
      );
    }
    if (status >= 500) {
      throw new InternalServerErrorException(`Meta Graph API error ${status} while validating the token`);
    }
    const code = metaError?.code ? `, code ${metaError.code}` : '';
    throw new BadRequestException(`Meta rejected the new access token (HTTP ${status}${code}): ${detail}`);
  }

  if (String(data?.id ?? '') !== String(phoneNumberId)) {
    throw new BadRequestException('The new access token does not have access to this phone number');
  }
}
