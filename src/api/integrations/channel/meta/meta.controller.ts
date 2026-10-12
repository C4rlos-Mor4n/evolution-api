import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Integration } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';
import axios from 'axios';

import { ChannelController, ChannelControllerInterface } from '../channel.controller';

export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger = new Logger('MetaController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor);
  }

  integrationEnabled: boolean;

  public async receiveWebhook(data: any) {
    if (data?.object !== 'whatsapp_business_account') {
      return { status: 'success' };
    }

    if (data.entry?.[0]?.changes?.[0]?.field === 'message_template_status_update') {
      try {
        const template = await this.prismaRepository.template.findFirst({
          where: { templateId: `${data.entry[0].changes[0].value.message_template_id}` },
        });

        if (!template?.webhookUrl) {
          this.logger.warn('template not found or without webhookUrl');
          return { status: 'success' };
        }

        await axios.post(template.webhookUrl, data.entry[0].changes[0].value, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logger.error(['Error forwarding template status update', error?.message]);
      }
      return { status: 'success' };
    }

    // Every entry x change is dispatched on its own (previously only entry[0].changes[0] was read, even
    // when Meta batched several), and a failure in one never affects the others nor the 200 sent to Meta
    // (a 5xx makes Meta retry the whole batch and duplicate events).
    for (const entry of data.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        this.dispatchChange(data, entry, change).catch((error) => {
          this.logger.error(['Error processing Meta webhook change', error?.message]);
        });
      }
    }

    return {
      status: 'success',
    };
  }

  private async dispatchChange(data: any, entry: any, change: any) {
    const numberId = change?.value?.metadata?.phone_number_id;

    if (!numberId) {
      this.logger.error('WebhookService -> receiveWebhookMeta -> numberId not found');
      return;
    }

    const instance = await this.prismaRepository.instance.findFirst({
      where: { number: numberId, integration: Integration.WHATSAPP_BUSINESS },
    });

    if (!instance) {
      this.logger.error('WebhookService -> receiveWebhookMeta -> instance not found');
      return;
    }

    const waInstance = this.waMonitor.waInstances[instance.name];

    if (!waInstance) {
      this.logger.error(`WebhookService -> receiveWebhookMeta -> instance ${instance.name} not loaded`);
      return;
    }

    await waInstance.connectToWhatsapp({ ...data, entry: [{ ...entry, changes: [change] }] });
  }
}
