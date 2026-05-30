'use client';

import { ERROR_MESSAGES } from '@/lib/error-messages';
import styles from '@/styles/ContactList.module.css';

interface RetryButtonProps {
  messageId: string;
  failReason?: string | null;
  onRetry: (messageId: string) => Promise<void>;
}

/** Retry button shown on FAILED outbound messages, with a tooltip showing the fail reason */
export function RetryButton({ messageId, failReason, onRetry }: RetryButtonProps) {
  const tooltip = failReason
    ? ERROR_MESSAGES.DELIVERY_FAILED(failReason)
    : ERROR_MESSAGES.DELIVERY_FAILED('Unknown error');

  return (
    <button
      type="button"
      className={styles.retryBtn}
      title={tooltip}
      onClick={() => onRetry(messageId)}
      aria-label="Retry sending this message"
    >
      ✗ Retry
    </button>
  );
}
