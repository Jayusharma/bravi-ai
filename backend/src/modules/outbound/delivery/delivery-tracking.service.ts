import { Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { OutboundService } from '../outbound.service';

@Injectable()
export class DeliveryTrackingService {
  private readonly logger = new Logger(DeliveryTrackingService.name);

  constructor(private readonly outboundService: OutboundService) {}

  /**
   * Handle SendGrid email event webhook.
   * SendGrid sends an array of events.
   */
  async handleSendGridDelivery(events: Array<Record<string, any>>): Promise<void> {
    for (const event of events) {
      const externalId = event.sg_message_id?.split('.')[0];
      if (!externalId) continue;

      const status = this.mapSendGridEvent(event.event);
      if (!status) {
        this.logger.debug(`Ignored SendGrid event: ${event.event}`);
        continue;
      }

      await this.outboundService.updateDeliveryStatusByExternalId(externalId, status);
      this.logger.log(`📬 SendGrid delivery: ${externalId} → ${status}`);
    }
  }

  private mapSendGridEvent(event: string): DeliveryStatus | null {
    const map: Record<string, DeliveryStatus> = {
      delivered: DeliveryStatus.DELIVERED,
      open: DeliveryStatus.READ,
      bounce: DeliveryStatus.FAILED,
      dropped: DeliveryStatus.FAILED,
      deferred: DeliveryStatus.SENT,
    };
    return map[event] ?? null;
  }
}
