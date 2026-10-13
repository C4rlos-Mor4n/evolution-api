import { RouterBroker } from '@api/abstract/abstract.router';
import { CloudCallActionDto, CloudCallSettingsDto, OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { callController } from '@api/server.module';
import {
  cloudCallAnswerSchema,
  cloudCallIdSchema,
  cloudCallSettingsSchema,
  offerCallSchema,
} from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class CallRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('offer'), ...guards, async (req, res) => {
        const response = await this.dataValidate<OfferCallDto>({
          request: req,
          schema: offerCallSchema,
          ClassRef: OfferCallDto,
          execute: (instance, data) => callController.offerCall(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      // WhatsApp Cloud API Calling (WHATSAPP-BUSINESS instances): signaling relay for user-initiated calls
      .post(this.routerPath('preAccept'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CloudCallActionDto>({
          request: req,
          schema: cloudCallAnswerSchema,
          ClassRef: CloudCallActionDto,
          execute: (instance, data) => callController.cloudCallAction(instance, 'pre_accept', data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('accept'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CloudCallActionDto>({
          request: req,
          schema: cloudCallAnswerSchema,
          ClassRef: CloudCallActionDto,
          execute: (instance, data) => callController.cloudCallAction(instance, 'accept', data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('reject'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CloudCallActionDto>({
          request: req,
          schema: cloudCallIdSchema,
          ClassRef: CloudCallActionDto,
          execute: (instance, data) => callController.cloudCallAction(instance, 'reject', data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('terminate'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CloudCallActionDto>({
          request: req,
          schema: cloudCallIdSchema,
          ClassRef: CloudCallActionDto,
          execute: (instance, data) => callController.cloudCallAction(instance, 'terminate', data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => callController.getCloudCallSettings(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<CloudCallSettingsDto>({
          request: req,
          schema: cloudCallSettingsSchema,
          ClassRef: CloudCallSettingsDto,
          execute: (instance, data) => callController.setCloudCallSettings(instance, data),
        });

        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
