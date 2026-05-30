'use client';

import styles from '@/styles/ContactList.module.css';

interface TypingIndicatorProps {
  /** Display name or initial of the agent who is typing */
  agentLabel: string;
}

/** Bouncing dots typing indicator — WhatsApp-style, left-aligned, auto-hides via parent */
export function TypingIndicator({ agentLabel }: TypingIndicatorProps) {
  return (
    <div className={styles.typingIndicator}>
      <span className={styles.typingDots}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={styles.typingDot}
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
      <span className={styles.typingLabel}>{agentLabel} is typing…</span>
    </div>
  );
}
