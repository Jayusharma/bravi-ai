

export interface WhatsAppTextMessage {
  body: string;
}


export interface WhatsAppMessage {
  id: string;                    // wamid.xxxx (unique message ID)
  from: string;                  // sender phone number (e.g., "919876543210")
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
