// whatsapp-webhook.dto.ts — the payload Meta's Cloud API POSTs to /webhook/whatsapp/meta.
// Real messages live (deeply) at entry[0].changes[0].value.messages[0]; delivery receipts
// arrive in the same shape but under value.statuses[] instead — we ignore those on inbound.

export interface WhatsAppTextMessage {
  body: string;
}

export interface WhatsAppMessage {
  id: string;                    // wamid.xxxx (unique message ID — our externalId / dedup key)
  from: string;                  // sender phone number WITHOUT '+' (e.g., "919876543210")
  timestamp: string;             // unix timestamp as string
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contacts' | 'interactive' | 'button' | 'reaction';
  text?: WhatsAppTextMessage;    // present when type === 'text'
}

// ─── Contact (sender profile) ────────────────────────────────────
export interface WhatsAppContact {
  profile: {
    name: string;                // sender's WhatsApp display name
  };
  wa_id: string;                 // sender's phone number
}

// ─── Envelope Meta wraps everything in ───────────────────────────
export interface MetaChangeValue {
  messaging_product: string;     // always "whatsapp"
  metadata?: {
    display_phone_number: string; // OUR business number (the "to")
    phone_number_id: string;      // matches ChannelConnection.externalAccountId
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];  // inbound customer messages
  statuses?: unknown[];          // delivery receipts (sent/delivered/read) — not inbound
}

export interface MetaWhatsAppPayload {
  object: string;                // "whatsapp_business_account"
  entry?: {
    id: string;                  // WhatsApp Business Account id
    changes?: {
      field: string;             // "messages"
      value: MetaChangeValue;
    }[];
  }[];
}
