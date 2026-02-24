import { MessageChannel } from '@prisma/client';

/**
 * WHAT: Every channel (WhatsApp, Email, SMS) implements this interface.
 * WHY:  The outbound service doesn't need to know HOW to send a message.
 *       It just calls adapter.send() and the adapter handles the specifics.
 *       This makes adding new channels trivial: just create a new adapter.
 *
 * PATTERN: Strategy pattern — swap implementations without changing the caller.
 */
export interface SendParams {
  to: string;        // recipient (phone number or email address)
  content: string;   // message body
  subject?: string;  // for email only
  replyTo?: string;  // for email threading (In-Reply-To header)
}

export interface SendResult {
  success: boolean;
  externalId?: string;  // Provider's message ID for tracking
  error?: string;       // Error message if failed
}

export interface ChannelAdapter {
  readonly channel: MessageChannel;

  /**
   * Send a message via this channel.
   * Returns the provider's message ID on success.
   */
  send(params: SendParams): Promise<SendResult>;

  /**
   * Check if this adapter is properly configured and ready to send.
   */
  isConfigured(): boolean;
}