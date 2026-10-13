import { CloudCallAction, CloudCallActionDto, CloudCallSettingsDto, OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { WAMonitoringService } from '@api/services/monitor.service';
import { BadRequestException } from '@exceptions';

export class CallController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async offerCall({ instanceName }: InstanceDto, data: OfferCallDto) {
    return await this.waMonitor.waInstances[instanceName].offerCall(data);
  }

  public async cloudCallAction({ instanceName }: InstanceDto, action: CloudCallAction, data: CloudCallActionDto) {
    return await this.cloudCallingInstance(instanceName).cloudCallAction(action, data);
  }

  public async getCloudCallSettings({ instanceName }: InstanceDto) {
    return await this.cloudCallingInstance(instanceName).getCloudCallSettings();
  }

  public async setCloudCallSettings({ instanceName }: InstanceDto, data: CloudCallSettingsDto) {
    return await this.cloudCallingInstance(instanceName).setCloudCallSettings(data);
  }

  // Cloud API Calling exists only on WHATSAPP-BUSINESS instances
  private cloudCallingInstance(instanceName: string) {
    const instance = this.waMonitor.waInstances[instanceName];
    if (typeof instance?.cloudCallAction !== 'function') {
      throw new BadRequestException('Cloud API calling is only available for WHATSAPP-BUSINESS instances');
    }
    return instance;
  }
}
