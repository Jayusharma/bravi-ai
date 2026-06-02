'use client';

import { useState, useCallback, useRef } from 'react';
import { getSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import { ERROR_MESSAGES } from '@/lib/error-messages';

const ACK_TIMEOUT_MS = 5000;

interface SendInput {
  enquiryId: string;
  channel: string;
  subject?: string;
  body?: string;
  draftId?: string | null;
  recipientOverride?: string;
}

interface SendAck {
  messageId: string;
  jobId: string;
  status: 'PENDING';
  error?: string;
}

interface UseOutboundSendReturn {
  send: (input: SendInput) => Promise<SendAck | null>;
  isSending: boolean;
  sendError: string | null;
  clearError: () => void;
}

/**
 * Emits outbound:send via socket and waits for ack (5s timeout).
 * Falls back to offline toast if socket is disconnected.
 */
export function useOutboundSend(): UseOutboundSendReturn {
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const send = useCallback(async (input: SendInput): Promise<SendAck | null> => {
    if (isSending) return null;
    setIsSending(true);
    setSendError(null);
    abortRef.current = false;

    try {
      let sock: Awaited<ReturnType<typeof getSocket>>;
      try {
        sock = await getSocket();
      } catch {
        setSendError(ERROR_MESSAGES.SEND_OFFLINE);
        return null;
      }

      if (!sock.connected) {
        setSendError(ERROR_MESSAGES.SEND_OFFLINE);
        return null;
      }

      const payload = {
        enquiryId: input.enquiryId,
        channel: input.channel,
        subject: input.subject,
        body: input.body,
        draftId: input.draftId ?? undefined,
        recipientOverride: input.recipientOverride,
      };

      const ack = await new Promise<SendAck | null>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, ACK_TIMEOUT_MS);

        sock.emit(SOCKET_EVENTS.OUTBOUND_SEND, payload, (response: SendAck) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      if (!ack) {
        setSendError(ERROR_MESSAGES.SEND_ACK_TIMEOUT);
        return null;
      }

      if (ack.error) {
        setSendError(ack.error);
        return null;
      }

      return ack;
    } finally {
      if (!abortRef.current) setIsSending(false);
    }
  }, [isSending]);

  const clearError = useCallback(() => setSendError(null), []);

  return { send, isSending, sendError, clearError };
}
