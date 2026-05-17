import { IngestMessageDto } from '@/modules/Ingestion/dto/incoming-message.dto';

export interface WebhookNormalizer<T = any> {
    /** Returns true if this payload contains a processable inbound message */
    canProcess(payload: T): boolean;

    /** Transforms raw webhook payload into the standard ingestion DTO */
    normalize(payload: T): IngestMessageDto | null;
}
