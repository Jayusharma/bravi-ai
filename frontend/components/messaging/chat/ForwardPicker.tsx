'use client';

import { useState, useEffect } from 'react';
import { getConversations, forwardMessage, type ConversationPreview } from '@/services/messaging/chat.service';
import { useToast } from '@/components/ui/Toast';
import styles from '@/styles/ContactList.module.css';

interface ForwardPickerProps {
  /** The message being forwarded */
  sourceMessageId: string;
  /** Current contact — excluded from the target list */
  excludeContactId?: string;
  onClose: () => void;
}

/**
 * Modal to pick a target conversation and forward a message into it.
 * Reuses the contact-selector modal styles from the Composer.
 */
export function ForwardPicker({ sourceMessageId, excludeContactId, onClose }: ForwardPickerProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ConversationPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Load conversations (debounced on search)
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await getConversations({ search });
        if (active) setOptions(res.data);
      } catch {
        /* silent — empty state covers it */
      } finally {
        if (active) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);

  const handleForward = async (target: ConversationPreview) => {
    if (sendingId) return;
    setSendingId(target.contactId);
    try {
      await forwardMessage(sourceMessageId, target.enquiryId);
      toast.success('Message forwarded', `Sent to ${target.contactName}`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to forward message';
      toast.error('Forward failed', message);
      setSendingId(null);
    }
  };

  const visibleOptions = excludeContactId
    ? options.filter((c) => c.contactId !== excludeContactId)
    : options;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.contactSelectorModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>Forward to…</h3>
          <button type="button" className={styles.modalCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalSearchBox}>
          <input
            type="text"
            className={styles.modalSearchInput}
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className={styles.contactSelectorList}>
          {loading && visibleOptions.length === 0 ? (
            <div className={styles.emptyState}>Loading…</div>
          ) : visibleOptions.length === 0 ? (
            <div className={styles.emptyState}>No conversations found</div>
          ) : (
            visibleOptions.map((c) => (
              <div
                key={c.contactId}
                className={styles.contactSelectorItem}
                onClick={() => handleForward(c)}
                style={{ opacity: sendingId && sendingId !== c.contactId ? 0.5 : 1 }}
              >
                <div className={styles.selectorAvatar}>{c.contactName.charAt(0).toUpperCase()}</div>
                <div className={styles.selectorInfo}>
                  <div className={styles.selectorName}>{c.contactName}</div>
                  {c.identifier && <div className={styles.selectorDetail}>{c.identifier}</div>}
                </div>
                {sendingId === c.contactId && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
