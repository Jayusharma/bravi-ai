// meta-whatsapp.adapter.ts — sends outbound WhatsApp messages via Meta's official Cloud API.
//
// Selected by AdapterFactory whenever the channel is WHATSAPP — credentials always come from
// the active ChannelConnection (ChannelRouterService decrypts and passes them in), no env fallback.

import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { ChannelAdapter, ResolvedCredentials, SendParams, SendResult } from './channel-adapter.interface';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

@Injectable()
export class MetaWhatsAppAdapter implements ChannelAdapter {
  readonly channel = MessageChannel.WHATSAPP;
  private readonly logger = new Logger(MetaWhatsAppAdapter.name);

  /** Ready only when the connected channel's creds were resolved — no env defaults for Meta. */
  isConfigured(creds?: ResolvedCredentials): boolean {
    return !!(creds?.accessToken && creds?.phoneNumberId);
  }

  async send(params: SendParams, creds?: ResolvedCredentials): Promise<SendResult> {
    if (!this.isConfigured(creds)) {
      return { success: false, error: 'WhatsApp (Meta) connection credentials missing' };
    }

    // Meta wants bare digits ("919876..."); our ContactChannel identifiers carry a '+'.
    const to = params.to.replace(/^\+/, '');

    try {
      // 1) The text message (the staff reply itself)
      let externalId: string | undefined;
      if (params.content?.trim()) {
        const result = await this.postMessage(creds!, {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: params.content },
        });
        if (!result.success) return result;
        externalId = result.externalId;
      }

      // 2) Each attachment goes as its own media message (Meta = one media per message).
      //    A failed attachment logs a warning but doesn't fail the send — the text already went.
      for (const att of params.attachments ?? []) {
        const isImage = att.mimeType.startsWith('image/');
        const result = await this.postMessage(creds!, {
          messaging_product: 'whatsapp',
          to,
          type: isImage ? 'image' : 'document',
          ...(isImage
            ? { image: { link: att.cdnUrl } }
            : { document: { link: att.cdnUrl, filename: att.fileName } }),
        });
        if (!result.success) {
          this.logger.warn(`Meta media send failed for ${att.fileName}: ${result.error}`);
        } else {
          externalId = externalId ?? result.externalId; // first media wamid if there was no text
        }
      }

      if (!externalId) {
        return { success: false, error: 'Nothing was sent — empty message and all attachments failed' };
      }

      this.logger.log(`📱 Meta WhatsApp sent → ${params.to} (wamid: ${externalId}, ${params.attachments?.length ?? 0} media)`);
      return { success: true, externalId };
    } catch (error: any) {
      this.logger.error(`Meta WhatsApp send error to ${params.to}: ${error.message}`);
      return { success: false, error: error.message, failReason: 'WhatsApp delivery failed.' };
    }
  }

  /** One Graph API call = one WhatsApp message. Returns the wamid on success. */
  private async postMessage(
    creds: ResolvedCredentials,
    body: Record<string, unknown>,
  ): Promise<SendResult> {
    const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = json?.error?.message ?? `HTTP ${res.status}`;
      this.logger.error(`Meta Graph API error: ${detail}`);
      return { success: false, error: detail, failReason: this.mapMetaError(json?.error) };
    }

    return { success: true, externalId: json?.messages?.[0]?.id };
  }

  /** Maps Meta Graph API error codes to agent-readable failure reasons. */
  private mapMetaError(error: any): string {
    const code = error?.code;
    const metaMessages: Record<number, string> = {
      131047: 'WhatsApp 24-hour window is closed — a template message is required.',
      131026: 'This number is not on WhatsApp or cannot receive messages.',
      131056: 'Too many messages to this number too quickly — try again shortly.',
      190: 'Meta access token expired — reconnect the channel in Administration → Channels.',
      100: 'Invalid request — check the recipient number.',
    };
    return metaMessages[code] ?? error?.message ?? 'WhatsApp delivery failed.';
  }
}
