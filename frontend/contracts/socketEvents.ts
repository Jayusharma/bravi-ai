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

export const MessageDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;


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
  // lastMessageSeq/lastReadSeq are the single source of truth for the unread badge —
  // derived as Math.max(0, lastMessageSeq - lastReadSeq), not stored anywhere separately.
  lastMessageSeq: z.number(),
  lastReadSeq: z.number(),
  lastReadAt: z.string().nullable(),
  unreadCount: z.number(),
  channels: z.array(ChannelSchema),
  assignedToId: z.string().nullable(),
  channelState: z.record(z.string(), z.unknown()).nullable(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * CONVERSATION_UPDATED socket payload — confirmed against a live-captured payload
 * (contact-keyed migration, see verification report). Contact-scoped now, not
 * enquiry-scoped: no enquiryId/status (an enquiry-level concept a contact-wide
 * event can't represent), no unreadDelta (replaced by lastMessageSeq/lastReadSeq —
 * the client derives unread as a subtraction, it's never told a delta anymore).
 */
export const ConversationUpdatedPayloadSchema = z.object({
  contactId: z.string(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string(),
  lastMessageChannel: ChannelSchema,
  lastMessageDirection: MessageDirectionSchema,
  lastMessageSeq: z.number(),
  lastReadSeq: z.number(),
  updatedField: z.string(),
});
export type ConversationUpdatedPayload = z.infer<typeof ConversationUpdatedPayloadSchema>;


// CONVERSATION_NEW — brand-new contact conversation, or an existing contact's
// new enquiry (see insertNewConversation's patch-or-insert handling). Confirmed
// against a live-captured payload — no enquiryStatus/messageCount/draft (those
// are per-enquiry sidebar-card concerns the REST list endpoint supplies; this
// realtime event only carries contact identity + the same message summary shape
// as CONVERSATION_UPDATED).
export const ConversationNewPayloadSchema = z.object({
  contactId: z.string(),
  contactName: z.string(),
  organization: z.string().nullable(),
  channel: ChannelSchema.nullable(),
  identifier: z.string().nullable(),
  enquiryId: z.string(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string(),
  lastMessageChannel: ChannelSchema,
  lastMessageDirection: MessageDirectionSchema,
  lastMessageSeq: z.number(),
  lastReadSeq: z.number(),
});
export type ConversationNewPayload = z.infer<typeof ConversationNewPayloadSchema>;

// contracts/socketEvents.ts — add below ConversationNewPayloadSchema

/**
 * Converts a CONVERSATION_NEW wire payload into the same shape used by
 * cached sidebar rows (Conversation). CONVERSATION_NEW no longer carries
 * assignedTo (dropped — that's a per-enquiry sidebar-card concern the REST
 * list endpoint supplies, not a realtime message-summary concern), so
 * assignedToId is left null here; the next full listConversations() refetch
 * fills it in.
 */
export function conversationFromNewPayload(payload: ConversationNewPayload): Conversation {
  return {
    contactId: payload.contactId,
    contactName: payload.contactName,
    lastMessagePreview: payload.lastMessagePreview,
    lastMessageAt: payload.lastMessageAt,
    lastMessageChannel: payload.lastMessageChannel,
    lastMessageSeq: payload.lastMessageSeq,
    lastReadSeq: payload.lastReadSeq,
    lastReadAt: null,
    unreadCount: Math.max(0, payload.lastMessageSeq - payload.lastReadSeq),
    channels: payload.channel ? [payload.channel] : [],
    assignedToId: null,
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
    // Most specific first: the actual last message's channel, THEN the contact's
    // primary channel as a fallback — not the other way around (a multi-channel
    // contact's badge/icon must reflect what they actually last messaged on).
    lastMessageChannel: (r.lastMessageChannel || r.lastMessage?.channel || r.channel || 'WHATSAPP') as Channel,
    lastMessageSeq: typeof r.lastMessageSeq === 'number' ? r.lastMessageSeq : 0,
    lastReadSeq: typeof r.lastReadSeq === 'number' ? r.lastReadSeq : 0,
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
  seq: z.number(),   // required — backend sends this on every MESSAGE_NEW now (Stage 0 fix, live-verified)
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

// Matches backend/src/websocket/app.gateway.ts's READ_MARK handler broadcast —
// seq-based, not a timestamp (confirmed against the actual emit site).
export const ReadUpdatedEventSchema = z.object({
  contactId: z.string(),
  lastReadSeq: z.number(),
});
export type ReadUpdatedEvent = z.infer<typeof ReadUpdatedEventSchema>;

// Global nav badge — distinct-unread-contact counts per channel. GLOBAL broadcast (team
// watermark, not per-user) — matches backend/src/modules/messaging/messaging.service.ts
// getUnreadSummary()'s return shape exactly.
export const UnreadSummarySchema = z.record(z.string(), z.number());
export type UnreadSummary = z.infer<typeof UnreadSummarySchema>;


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

