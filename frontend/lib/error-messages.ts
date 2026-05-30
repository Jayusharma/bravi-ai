// error-messages.ts — All user-facing error strings. Import from here — never hardcode in components.

export const ERROR_MESSAGES = {
  SEND_OFFLINE:           "You're offline. Your draft is saved — reconnect and try again.",
  SEND_ACK_TIMEOUT:       "Send timed out. Your draft is saved — try again.",
  DELIVERY_FAILED:        (reason: string) => `Message couldn't be delivered: ${reason}. Tap retry.`,
  ATTACHMENT_TOO_LARGE:   (sizeMB: number) => `File is ${sizeMB}MB. WhatsApp allows up to 16MB for media.`,
  ATTACHMENT_TOO_LARGE_EMAIL: (sizeMB: number) => `Attachments total ${sizeMB}MB. Email allows up to 25MB.`,
  WHATSAPP_WINDOW_CLOSED: "Customer hasn't messaged in 24 hours. Use a template message.",
  DRAFT_SAVE_FAILED:      "Couldn't save draft. Check your connection.",
} as const;
