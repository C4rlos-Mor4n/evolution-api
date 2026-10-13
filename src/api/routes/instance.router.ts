import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto, MetaCredentialsDto, SetPresenceDto } from '@api/dto/instance.dto';
import { globalApiKeyGuard } from '@api/guards/global-apikey.guard';
import { instanceExistsGuard } from '@api/guards/instance.guard';
import { instanceController } from '@api/server.module';
import { ConfigService } from '@config/env.config';
import { instanceSchema, metaCredentialsSchema, presenceOnlySchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class InstanceRouter extends RouterBroker {
  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.router
      .post('/create', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.createInstance(instance),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      // Rotate the Meta access token. Global api key ONLY (not the instance token), checked before the
      // existence check so the route cannot be used to probe instance names.
      .patch(this.routerPath('meta-credentials'), globalApiKeyGuard, instanceExistsGuard, async (req, res) => {
        const response = await this.dataValidate<MetaCredentialsDto>({
          request: req,
          schema: metaCredentialsSchema,
          ClassRef: MetaCredentialsDto,
          execute: (instance, data) => instanceController.updateMetaCredentials(instance, data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('restart'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.restartInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connect'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectToWhatsapp(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connectionState'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectionState(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchInstances', false), ...guards, async (req, res) => {
        const key = req.get('apikey');

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.fetchInstances(instance, key),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('setPresence'), ...guards, async (req, res) => {
        const response = await this.dataValidate<null>({
          request: req,
          schema: presenceOnlySchema,
          ClassRef: SetPresenceDto,
          execute: (instance, data) => instanceController.setPresence(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .delete(this.routerPath('logout'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.logout(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.deleteInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
