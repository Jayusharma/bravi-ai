import { z } from 'zod';

/**
 * ============================================================================
 * SOCKET EVENT CONTRACTS
 * Ordered by BUILD SEQUENCE, not alphabetically. Read top to bottom = build order.
 * ============================================================================
 */

// ── shared primitives, used everywhere below ──

export const ChannelSchema = z.enum(['WHATSAPP', 'EMAIL']);
export type Channel = z.infer<typeof ChannelSchema>;


// ============================================================================
// 🟢 ACTIVE NOW — Conversation Updated (sidebar bump + unread badge)
// This is what we're wiring this week. Everything below this block exists
// only to support this one event.
// ============================================================================

/** One row in the sidebar list. What GET /conversations returns per contact. */
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

/**
 * CONVERSATION_UPDATED socket payload — confirmed against real console log:
 * { enquiryId, contactId, lastMessagePreview, lastActivityAt, status, unreadDelta, updatedField }
 */
export const ConversationUpdatedPayloadSchema = z.object({
  enquiryId: z.string(),
  contactId: z.string(),
  lastMessagePreview: z.string(),
  lastMessageChannel: ChannelSchema.optional(),
  lastActivityAt: z.string(),
  status: z.string(),
  unreadDelta: z.number(),   // backend-computed. NEVER hardcode +1 on the frontend — see notes.
  updatedField: z.string(),
});
export type ConversationUpdatedPayload = z.infer<typeof ConversationUpdatedPayloadSchema>;


//conversation_new when contact doesn't exist its completely new row 
export const ConversationNewPayloadSchema = z.object({
  contactId: z.string(),
  contactName: z.string(),
  organization: z.string().nullable(),
  channel: ChannelSchema.nullable(),
  identifier: z.string().nullable(),
  enquiryId: z.string(),
  enquiryStatus: z.string(),
  assignedTo: z.string().nullable(),
  messageCount: z.number(),
  lastMessage: z.string().nullable(),
  lastActivityAt: z.string(),
  draft: z.string().nullable(),
});
export type ConversationNewPayload = z.infer<typeof ConversationNewPayloadSchema>;

// contracts/socketEvents.ts — add below ConversationNewPayloadSchema

/**
 * Converts a CONVERSATION_NEW wire payload into the same shape used by
 * cached sidebar rows (Conversation). Field names differ between the two —
 * see the side-by-side comparison from the last step — this is the
 * translation layer that reconciles them.
 */
export function conversationFromNewPayload(payload: ConversationNewPayload): Conversation {
  return {
    contactId: payload.contactId,
    contactName: payload.contactName,
    lastMessagePreview: payload.lastMessage ?? '',
    lastMessageAt: payload.lastActivityAt,
    lastMessageChannel: payload.channel ?? 'WHATSAPP',
    lastReadAt: null,
    unreadCount: 1,
    channels: payload.channel ? [payload.channel] : [],
    assignedToId: payload.assignedTo,
    channelState: null,
  };
}

/** Defensive normalizer — fills gaps if the backend sends a slightly different shape than expected. */
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
      ? r.channels.map((ch: any) => (typeof ch === 'string' ? ch : ch.channel))
      : [r.channel || 'WHATSAPP'],
    assignedToId: r.assignedToId || r.assignedTo?.id || null,
    channelState: r.channelState || null,
  };

  const result = ConversationSchema.safeParse(normalized);
  if (!result.success) {
    console.warn('⚠️ [Conversation Parser] Falling back on invalid shape:', result.error.format(), raw);
    return normalized as Conversation;
  }
  return result.data;
}


// ============================================================================
// 🟡 NEXT — Global Notification (toast/sound, not wired to cache)
// Not built yet. Coming right after Conversation Updated is confirmed working.
// ============================================================================

export const NotificationNewMessageEventSchema = z.object({
  contactId: z.string(),
  enquiryId: z.string(),
  messagePreview: z.string(),
  messageId: z.string(),
});
export type NotificationNewMessageEvent = z.infer<typeof NotificationNewMessageEventSchema>;


// ============================================================================
// 🔵 LATER — Phase 2: Message thread (needs room-join wired in ChatView first)
// Kept here so the shape exists, but nothing calls these yet. Do not build
// against these until useContactRoom is actually mounted somewhere.
// ============================================================================

export const MessageDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageStatusSchema = z.enum([
  'SENDING', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BOUNCED', 'RECEIVED',
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const AttachmentKindSchema = z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE_NOTE']);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

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

/** One message bubble in a thread. */
export const MessageSchema = z.object({
  id: z.string(),
  seq: z.number().optional(),   // backend doesn't send this yet — confirmed via console log
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

/** Defensive normalizer for MESSAGE_NEW — unwraps { contactId, enquiryId, message } wrapper if present. */
export function parseSocketMessage(raw: unknown): Message {
  const r = (raw && typeof raw === 'object' && 'message' in (raw as any) ? (raw as any).message : raw) as Record<string, any>;
  const topContactId = (raw && typeof raw === 'object' && 'contactId' in (raw as any) ? (raw as any).contactId : '') as string;
  const topEnquiryId = (raw && typeof raw === 'object' && 'enquiryId' in (raw as any) ? (raw as any).enquiryId : '') as string;

  const normalized = {
    id: r.id || `temp-${Date.now()}`,
    seq: typeof r.seq === 'number' ? r.seq : undefined,
    clientMessageId: r.clientMessageId || null,
    contactId: r.contactId || topContactId || '',
    enquiryId: r.enquiryId || topEnquiryId || '',
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
    console.warn('⚠️ [Message Parser] Falling back on invalid shape:', result.error.format(), raw);
    return normalized as Message;
  }
  return result.data;
}


// ============================================================================
// 🔵 LATER — Phase 5: Optimistic send, retry, delivery status
// Backend already emits these (OUTBOUND_SENT, OUTBOUND_FAILED, chat.receipts.updated).
// Nothing on the frontend listens for them yet.
// ============================================================================

export const MessageStatusEventSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  status: MessageStatusSchema,
  seq: z.number().optional(),
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


// ============================================================================
// ⚪ NOT YET SCOPED — no confirmed backend event/consumer decided
// ============================================================================

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

