/**
 * Payload shape that Twilio sends via POST (application/x-www-form-urlencoded)
 * when an inbound WhatsApp message arrives.
 */
export interface TwilioWhatsAppPayload {
    MessageSid: string;
    SmsMessageSid: string;
    AccountSid: string;
    From: string;          // 'whatsapp:+919876543210'
    To: string;            // 'whatsapp:+14155238886'
    Body: string;
    ProfileName?: string;  // sender's WhatsApp display name
    NumMedia: string;      // '0' or a positive number
    SmsStatus: string;     // 'received' for inbound messages
    NumSegments: string;
    WaId: string;          // sender phone without whatsapp: prefix
    ApiVersion: string;
}

/**
 * Payload shape for Twilio delivery status callbacks.
 * Twilio sends these to the SAME webhook URL unless you configure a separate StatusCallback.
 */
export interface TwilioStatusPayload {
    MessageSid: string;
    MessageStatus: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';
    To: string;
    From: string;
    ErrorCode?: string;
    ErrorMessage?: string;
}
