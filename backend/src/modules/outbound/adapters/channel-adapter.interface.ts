import { MessageChannel } from '@prisma/client';

/**
 * WHAT: Every channel (WhatsApp, Email, SMS) implements this interface.
 * WHY:  The outbound service doesn't need to know HOW to send a message.
 *       It just calls adapter.send() and the adapter handles the specifics.
 *       This makes adding new channels trivial: just create a new adapter.
 *
 * PATTERN: Strategy pattern — swap implementations without changing the caller.
 */
export interface AttachmentParam {
  cdnUrl: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

export interface SendParams {
  to: string;
  content: string;
  subject?: string;
  replyTo?: string;
  attachments?: AttachmentParam[];
}

export interface SendResult {
  success: boolean;
  externalId?: string;  // Provider's message ID for tracking
  error?: string;       // Technical error string (for logs/retry decisions)
  failReason?: string;  // Human-readable failure reason (shown to agents in UI tooltip)
}

/**
 * Credentials resolved from a ChannelConnection row — passed in when one exists for this
 * channel. Fields are grouped by provider; ChannelRouterService fills the set matching the
 * connection's provider and the selected adapter reads only its own fields.
 */
export interface ResolvedCredentials {
  // SendGrid (email)
  apiKey?: string;
  fromEmail?: string;
  // Meta WhatsApp (Cloud API)
  accessToken?: string;
  phoneNumberId?: string;
}

export interface ChannelAdapter {
  readonly channel: MessageChannel;

  /**
   * Send a message via this channel.
   * `creds`, when present, comes from a connected ChannelConnection row and overrides
   * whatever the adapter set up in its own constructor — this is what makes the
   * Administration → Channels connect flow actually take effect.
   * Returns the provider's message ID on success.
   */
  send(params: SendParams, creds?: ResolvedCredentials): Promise<SendResult>;

  /**
   * Check if this adapter is ready to send, either with the given creds or its own defaults.
   */
  isConfigured(creds?: ResolvedCredentials): boolean;
}