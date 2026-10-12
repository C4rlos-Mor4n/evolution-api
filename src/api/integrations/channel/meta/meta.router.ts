import { RouterBroker } from '@api/abstract/abstract.router';
import { metaController } from '@api/server.module';
import { ConfigService, WaBusiness } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { Router } from 'express';

import { verifyMetaSignature } from './meta.signature';

const logger = new Logger('MetaRouter');

export class MetaRouter extends RouterBroker {
  constructor(readonly configService: ConfigService) {
    super();
    this.router
      .get(this.routerPath('webhook/meta', false), async (req, res) => {
        if (req.query['hub.verify_token'] === configService.get<WaBusiness>('WA_BUSINESS').TOKEN_WEBHOOK)
          res.send(req.query['hub.challenge']);
        else res.send('Error, wrong validation token');
      })
      .post(this.routerPath('webhook/meta', false), async (req, res) => {
        const waBusiness = configService.get<WaBusiness>('WA_BUSINESS');
        const signature = verifyMetaSignature(
          waBusiness,
          (req as typeof req & { rawBody?: Buffer }).rawBody,
          req.headers['x-hub-signature-256'],
        );

        if (signature === 'invalid' || signature === 'missing') {
          if (waBusiness.SIGNATURE_MODE === 'enforce') {
            logger.warn(`Rejected Meta webhook: signature ${signature}`);
            return res.status(401).json({ status: 'unauthorized' });
          }
          logger.warn(`Meta webhook signature ${signature} (mode=log, request accepted)`);
        }

        const { body } = req;
        const response = await metaController.receiveWebhook(body);

        return res.status(200).json(response);
      });
  }

  public readonly router: Router = Router();
}
