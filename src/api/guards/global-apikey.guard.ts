import { Auth, configService } from '@config/env.config';
import { UnauthorizedException } from '@exceptions';
import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Accepts ONLY the global AUTHENTICATION_API_KEY (never an instance token). Used for operations an
 * instance must not perform on itself, e.g. rotating its own credentials with a leaked/old token.
 */
export async function globalApiKeyGuard(req: Request, _: Response, next: NextFunction) {
  const globalKey = configService.get<Auth>('AUTHENTICATION').API_KEY?.KEY;
  const key = req.get('apikey');

  if (!globalKey || !key || !sameSecret(key, globalKey)) {
    throw new UnauthorizedException('This route requires the global api key');
  }

  next();
}
