import { z } from 'zod';

/**
 * ============================================================================
 * STEP 1: SOCKET EVENT CONTRACTS (Zod Schemas)
 * Spec Ref: Section 3.1 & 3.2
 * Single source of truth for all wire protocol types & runtime validations.
 * ============================================================================
 */

// ── Enums ──

export const ChannelSchema = z.enum(['WHATSAPP', 'EMAIL']);
export type Channel = z.infer<typeof ChannelSchema>;

export const MessageDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageStatusSchema = z.enum([
  'SENDING',
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'BOUNCED',
  'RECEIVED',
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const AttachmentKindSchema = z.enum([
  'IMAGE',
  'VIDEO',
  'DOCUMENT',
  'AUDIO',
  'VOICE_NOTE',
]);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

// ── Attachment Schema ──

export const AttachmentSchema = z.object({
  id: z.string(),
  kind: AttachmentKindSchema,
  fileName: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
  cdnUrl: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// ── Unified Core Message Schema ──

export const MessageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  clientMessageId: z.string().nullable(),
  contactId: z.string(),
  enquiryId: z.string(),
  channel: ChannelSchema,
  channelConnectionId: z.string(),
  direction: MessageDirectionSchema,
  body: z.string(),
  status: MessageStatusSchema,
  attachments: z.array(AttachmentSchema),
  createdAt: z.string(),
  authorId: z.string().nullable(),
  channelMeta: z.record(z.string(), z.unknown()).nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

// ── Unified Conversation Summary Schema ──

export const ConversationSchema = z.object({
  contactId: z.string(),
  contactName: z.string(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string(),
  lastMessageChannel: ChannelSchema,
  lastReadAt: z.string().nullable(),
  unreadCount: z.number(),
  channels: z.array(ChannelSchema),
  assignedToId: z.string().nullable(),
  channelState: z.record(z.string(), z.unknown()).nullable(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

// ── Individual Socket Event Payloads ──

export const MessageNewEventSchema = MessageSchema;
export type MessageNewEvent = z.infer<typeof MessageNewEventSchema>;

export const MessageStatusEventSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  status: MessageStatusSchema,
  seq: z.number(),
});
export type MessageStatusEvent = z.infer<typeof MessageStatusEventSchema>;

export const MessageFailedEventSchema = z.object({
  clientMessageId: z.string(),
  contactId: z.string(),
  reason: z.string(),
});
export type MessageFailedEvent = z.infer<typeof MessageFailedEventSchema>;

export const ReadUpdatedEventSchema = z.object({
  contactId: z.string(),
  lastReadAt: z.string(),
});
export type ReadUpdatedEvent = z.infer<typeof ReadUpdatedEventSchema>;

export const TypingEventSchema = z.object({
  contactId: z.string(),
  userId: z.string(),
  userName: z.string(),
  isTyping: z.boolean(),
});
export type TypingEvent = z.infer<typeof TypingEventSchema>;

export const PresenceEventSchema = z.object({
  userId: z.string(),
  online: z.boolean(),
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

export const ContactUpdatedEventSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  organization: z.string().nullable().optional(),
});
export type ContactUpdatedEvent = z.infer<typeof ContactUpdatedEventSchema>;

export const ChannelStateEventSchema = z.object({
  contactId: z.string(),
  channel: ChannelSchema,
  state: z.record(z.string(), z.unknown()),
});
export type ChannelStateEvent = z.infer<typeof ChannelStateEventSchema>;

// ── Validation Helpers (STUBBED FOR DECISION LOGIC) ──

/**
 * Validates and normalizes raw message payload into a clean Message or fallback.
 */
export function parseSocketMessage(raw: unknown): Message {
  const r = raw as Record<string, any>;
  
  const normalized = {
    id: r.id || `temp-${Date.now()}`,
    seq: typeof r.seq === 'number' ? r.seq : 0,
    clientMessageId: r.clientMessageId || null,
    contactId: r.contactId || '',
    enquiryId: r.enquiryId || '',
    channel: (r.channel || 'WHATSAPP') as Channel,
    channelConnectionId: r.channelConnectionId || '',
    direction: (r.direction || 'INBOUND') as any,
    body: r.body || r.content || '',
    status: (r.status || r.deliveryStatus || 'SENT') as any,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    createdAt: r.createdAt || new Date().toISOString(),
    authorId: r.authorId || r.sentByUserId || null,
    channelMeta: r.channelMeta || null,
  };

  const result = MessageSchema.safeParse(normalized);
  if (!result.success) {
    console.warn(
      '⚠️ [Message Parser Warning] Normalizing message fallback:',
      result.error.format(),
      raw
    );
    return normalized as Message;
  }
  return result.data;
}
/**
 * Validates and normalizes raw conversation summary payload into a clean Conversation.
 */
export function parseSocketConversation(raw: unknown): Conversation {
  const r = raw as Record<string, any>;
  
  const normalized = {
    contactId: r.contactId || r.id || '',
    contactName: r.contactName || r.displayName || 'Unknown Contact',
    lastMessagePreview: r.lastMessagePreview || r.lastMessage?.content || '',
    lastMessageAt: r.lastMessageAt || r.lastMessage?.createdAt || r.lastActivityAt || null,
    lastMessageChannel: (r.lastMessageChannel || r.channel || r.lastMessage?.channel || 'WHATSAPP') as Channel,
    lastReadAt: r.lastReadAt || null,
    unreadCount: typeof r.unreadCount === 'number' ? r.unreadCount : 0,
    channels: Array.isArray(r.channels)
      ? r.channels.map((ch: any) => typeof ch === 'string' ? ch : ch.channel)
      : [r.channel || 'WHATSAPP'],
    assignedToId: r.assignedToId || r.assignedTo?.id || null,
    channelState: r.channelState || null,
  };

  const result = ConversationSchema.safeParse(normalized);
  if (!result.success) {
    console.warn(
      '⚠️ [Conversation Parser Warning] Normalizing conversation fallback:',
      result.error.format(),
      raw
    );
    return normalized as Conversation;
  }
  return result.data;
}