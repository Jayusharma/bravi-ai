import { ComponentType } from 'react';
import {
  Channel,
  Message,
  Conversation,
  MessageStatus,
  Attachment,
} from '@/contracts/socketEvents';

/**
 * ============================================================================
 * STEP 3: CHANNEL ADAPTER INTERFACE
 * Spec Ref: Section 4
 * The contract that all channel-specific adapters (WhatsApp, Email, etc.) must fulfill.
 * Core code interacts ONLY with this interface — never checking channel strings directly.
 * ============================================================================
 */

export interface ContactInfo {
  id: string;
  displayName: string;
  organization?: string | null;
}

export interface SendMessageInput {
  contactId: string;
  enquiryId: string;
  channel: Channel;
  body: string;
  subject?: string;
  attachments?: Attachment[];
  templateId?: string;
  templateVariables?: Record<string, string>;
  channelMeta?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: Record<string, string>;
  message?: string;
}

export interface FreeformWindowStatus {
  allowed: boolean;
  reason?: string;
  expiresAt?: string;
}

export interface AttachmentLimits {
  maxBytes: number;
  maxCount: number;
  mimeTypes: string[];
}

export interface ChannelAdapter {
  id: Channel;
  label: string;
  icon: ComponentType<{ className?: string }>;
  accentColor: string;

  // ---- Send-Time Constraints ----
  /** Can the agent type freeform right now, or is the send window closed? */
  canSendFreeform(conv: Conversation): FreeformWindowStatus;

  /** Fields the composer must collect beyond `body` (e.g. Email requires 'subject') */
  requiredFields: string[];

  /** Max size, count, and allowed mime types for attachments */
  attachmentLimits: AttachmentLimits;

  /** Validate outbound input before dispatching */
  validate(input: SendMessageInput, conv: Conversation): ValidationResult;

  /** Build the channelMeta payload for an outbound message */
  buildMeta(input: SendMessageInput, conv: Conversation): Record<string, unknown>;

  // ---- Render Component Slots ----
  /** Channel-specific message body renderer (e.g. DOMPurified HTML for Email, Markdown/Media for WhatsApp) */
  MessageBody: ComponentType<{ message: Message }>;

  /** Extra fields rendered inside composer (e.g. Subject/CC for Email, Template Picker for WhatsApp) */
  ComposerExtras: ComponentType<{ contactId: string; conv: Conversation }>;

  /** Formatted identity label (e.g. formatted phone number vs email address) */
  IdentityLabel: ComponentType<{ contact: ContactInfo }>;

  /** Optional meta slot (e.g. reply-to quotes, story references) */
  MessageMeta?: ComponentType<{ message: Message }>;

  // ---- Status & Preview ----
  /** Allowed delivery status progression for this channel */
  statusLadder: MessageStatus[];

  /** Human-readable status label */
  statusLabel(status: MessageStatus): string;

  /** Sidebar card preview text (e.g. Email displays subject, WhatsApp displays body) */
  previewText(msg: Message): string;
}
