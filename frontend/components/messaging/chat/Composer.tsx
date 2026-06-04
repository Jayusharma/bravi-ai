'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConversationThread, ThreadMessage } from '@/services/messaging/chat.service';
import { getConversations, type ConversationPreview } from '@/services/messaging/chat.service';

import { getSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import { useUpload } from '@/hooks/messaging/useUpload';
import { useDraft } from '@/hooks/messaging/useDraft';
import { useOutboundSend } from '@/hooks/messaging/useOutboundSend';
import { AttachmentPreview } from '@/components/messaging/chat/AttachmentPreview';
import { DraftStatusIndicator } from '@/components/messaging/chat/DraftStatusIndicator';
import styles from '@/styles/ContactList.module.css';

interface ComposerProps {
  enquiryId: string | null;
  channel: 'WHATSAPP' | 'EMAIL';
  contact: ConversationThread['contact'];
  onMessageSent: (msg: ThreadMessage) => void;
  onMessageAck?: (tempId: string, messageId: string) => void;
  onMessageError?: (tempId: string, error: string) => void;
  onPreviewImage?: (src: string, fileName: string) => void;
}

const MAX_ATTACHMENTS = 20;

/** Channel-aware composer with debounced draft auto-save and socket send */
export function Composer({
  enquiryId,
  channel,
  contact,
  onMessageSent,
  onMessageAck,
  onMessageError,
  onPreviewImage,
}: ComposerProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactOptions, setContactOptions] = useState<ConversationPreview[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSendingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const paperclipBtnRef = useRef<HTMLButtonElement>(null);
  const photoVideoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    draft,
    updateDraft,
    discardDraft,
    clearLocalDraftState,
    saveForLater,
    removeExistingAttachment,
    isDirty,
    isSaving,
    saveError,
  } = useDraft(enquiryId, channel);

  const { send, isSending, sendError, clearError: clearSendError } = useOutboundSend();

  const { uploads, addFiles, removeFile, retryFile, clearAll: clearUploads, isUploading } = useUpload(draft.id);

  // Auto-resize textarea height as content changes
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to calculate scrollHeight correctly
    textarea.style.height = 'auto';

    // Set new height based on scrollHeight
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = `${scrollHeight}px`;

    // Toggle scrollbar visibility depending on max-height limit (120px)
    if (scrollHeight > 120) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [draft.body, adjustTextareaHeight]);

  // Reset on enquiry/channel change
  useEffect(() => {
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
    isTypingRef.current = false;
    setShowAttachmentMenu(false);
    setError(null);
    clearSendError();
  }, [enquiryId, channel]);

  // Click-outside handler for attachment menu
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        attachmentMenuRef.current && !attachmentMenuRef.current.contains(e.target as Node) &&
        paperclipBtnRef.current && !paperclipBtnRef.current.contains(e.target as Node)
      ) setShowAttachmentMenu(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Load contacts for contact-card selector
  useEffect(() => {
    if (!showContactSelector) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingContacts(true);
      try {
        const res = await getConversations({ search: contactSearch });
        if (active) setContactOptions(res.data);
      } catch { /* silent */ }
      finally { if (active) setLoadingContacts(false); }
    }, contactSearch ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [showContactSelector, contactSearch]);

  const recipientChannel = contact.channels.find((c) => c.channel === channel)
    ?? contact.channels.find((c) => c.isPrimary)
    ?? contact.channels[0]
    ?? null;
  const to = recipientChannel?.identifier ?? null;

  const hasAnyAttachment = uploads.some((u) => u.status === 'done') || draft.attachments.length > 0;
  const canSend = !!enquiryId && !!to && (draft.body.trim().length > 0 || hasAnyAttachment) && !isSending && !isUploading;

  const emitTyping = useCallback(async () => {
    if (channel !== 'WHATSAPP' || !enquiryId) return;
    try {
      const sock = await getSocket();
      const payload = { enquiryId, contactId: contact.id };
      if (!isTypingRef.current) { isTypingRef.current = true; sock.emit(SOCKET_EVENTS.TYPING_START, payload); }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        isTypingRef.current = false;
        sock.emit(SOCKET_EVENTS.TYPING_STOP, payload);
      }, 3000);
    } catch { /* silent */ }
  }, [channel, enquiryId, contact.id]);

  const handleSend = async () => {
    if (!canSend || !enquiryId) return;
    isSendingRef.current = true;
    setError(null);
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      getSocket().then((s) => s.emit(SOCKET_EVENTS.TYPING_STOP, { enquiryId, contactId: contact.id })).catch(() => {});
    }

    const tempId = crypto.randomUUID();
    const body = draft.body;
    const subject = draft.subject;
    const draftId = draft.id;

    // Optimistic message — merge existing draft attachments AND newly uploaded files.
    const optimisticMsg: ThreadMessage = {
      id: tempId,
      tempId,
      content: body,
      direction: 'OUTBOUND',
      channel,
      from: 'me',
      to,
      subject: subject || null,
      deliveryStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      sentByUser: null,
      attachments: [
        ...draft.attachments.map((a) => ({
          id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType,
          fileSize: a.fileSize, cdnUrl: a.cdnUrl ?? null,
        })),
        ...uploads
          .filter((u) => u.status === 'done' && u.result)
          .map((u) => ({
            id: u.result!.attachmentId,
            kind: u.result!.kind,
            fileName: u.result!.fileName,
            mimeType: u.file.type,
            fileSize: u.file.size,
            cdnUrl: u.result!.cdnUrl ?? null,
          })),
      ],
    };
    onMessageSent(optimisticMsg);

    // Instantly clear inputs and uploads locally
    clearLocalDraftState();
    clearUploads();
    isSendingRef.current = false;

    // Trigger send async in background
    send({
      enquiryId,
      channel,
      body,
      subject: subject || undefined,
      draftId,
      recipientOverride: to ?? undefined,
      tempId,
    }).then((ack) => {
      if (ack && ack.success !== false && ack.messageId) {
        onMessageAck?.(tempId, ack.messageId);
      } else {
        const errorMsg = ack?.error || 'Send failed';
        setError(errorMsg);
        onMessageError?.(tempId, errorMsg);
      }
    }).catch((err) => {
      const errorMsg = err.message ?? 'Send failed';
      setError(errorMsg);
      onMessageError?.(tempId, errorMsg);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && channel === 'WHATSAPP') { e.preventDefault(); handleSend(); }
    if (e.key === 'Enter' && e.ctrlKey && channel === 'EMAIL') { e.preventDefault(); handleSend(); }
  };

  const handleAddFiles = async (files: FileList | File[]) => {
    if (!enquiryId) return;
    const arr = Array.from(files);
    if (uploads.length + arr.length > MAX_ATTACHMENTS) {
      setError(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`);
      return;
    }
    addFiles(arr);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) { e.preventDefault(); handleAddFiles(files); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleAddFiles(Array.from(e.dataTransfer.files));
  };

  if (!enquiryId) {
    return (
      <div className={styles.composer}>
        <input className={styles.composerInput} placeholder="No active enquiry" disabled />
        <button className={styles.composerBtn} disabled>➤</button>
      </div>
    );
  }

  if (!to) {
    return (
      <div className={styles.composer}>
        <input className={styles.composerInput}
          placeholder={`No ${channel} channel for this contact`} disabled />
        <button className={styles.composerBtn} disabled>➤</button>
      </div>
    );
  }

  return (
    <div
      className={styles.composerWrapper}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      style={isDragOver ? { outline: '2px dashed #6366f1', outlineOffset: '-2px' } : undefined}
    >
      <DraftStatusIndicator
        isSaving={isSaving}
        isDirty={isDirty}
        saveError={saveError}
        hasDraft={!!draft.id}
        onSaveForLater={saveForLater}
      />

      {(error || sendError) && (
        <div className={styles.composerError}>
          ⚠️ {error || sendError}
          <button onClick={() => { setError(null); clearSendError(); }} className={styles.composerErrorDismiss}>✕</button>
        </div>
      )}

      {channel === 'EMAIL' && (
        <input
          type="text"
          value={draft.subject}
          onChange={(e) => updateDraft({ subject: e.target.value })}
          placeholder="Subject (optional)"
          className={styles.composerSubjectInput}
          disabled={isSending}
        />
      )}

      <AttachmentPreview
        uploads={uploads}
        existingAttachments={draft.attachments}
        onRemove={removeFile}
        onRetry={retryFile}
        onPreview={onPreviewImage}
        onRemoveExisting={removeExistingAttachment}
      />

      {/* Hidden file inputs */}
      <input ref={photoVideoInputRef} type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) { handleAddFiles(e.target.files); e.target.value = ''; } }} />
      <input ref={documentInputRef} type="file" multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.rar" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) { handleAddFiles(e.target.files); e.target.value = ''; } }} />
      <input ref={audioInputRef} type="file" multiple accept="audio/*" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) { handleAddFiles(e.target.files); e.target.value = ''; } }} />

      {/* Attachment popover menu */}
      {showAttachmentMenu && (
        <div ref={attachmentMenuRef} className={styles.attachmentMenu}>
          <button type="button" className={styles.attachmentMenuItem}
            onClick={() => { documentInputRef.current?.click(); setShowAttachmentMenu(false); }}>
            <div className={`${styles.attachmentIconCircle} ${styles.iconDocument}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <span>Document</span>
          </button>
          <button type="button" className={styles.attachmentMenuItem}
            onClick={() => { photoVideoInputRef.current?.click(); setShowAttachmentMenu(false); }}>
            <div className={`${styles.attachmentIconCircle} ${styles.iconPhotos}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a6 6 0 0 1 8.486 0L21.75 16.5m-19.5 3.75h19.5a2.25 2.25 0 0 0 2.25-2.25L21.75 7.5a2.25 2.25 0 0 0-2.25-2.25H2.25A2.25 2.25 0 0 0 0 7.5v9.25a2.25 2.25 0 0 0 2.25 2.25Z" />
                <circle cx="7.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <span>Photos & videos</span>
          </button>
          <button type="button" className={styles.attachmentMenuItem}
            onClick={() => { audioInputRef.current?.click(); setShowAttachmentMenu(false); }}>
            <div className={`${styles.attachmentIconCircle} ${styles.iconAudio}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H18a2.25 2.25 0 0 1-2.25-2.25V5.25A2.25 2.25 0 0 1 18 3h.75A2.25 2.25 0 0 1 21 5.25Zm-12 0V15A2.25 2.25 0 0 1 6.75 17.25H6A2.25 2.25 0 0 1 3.75 15V5.25A2.25 2.25 0 0 1 6 3h.75A2.25 2.25 0 0 1 9 5.25Z" />
              </svg>
            </div>
            <span>Audio</span>
          </button>
          <button type="button" className={styles.attachmentMenuItem}
            onClick={() => { setShowContactSelector(true); setShowAttachmentMenu(false); }}>
            <div className={`${styles.attachmentIconCircle} ${styles.iconContact}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <span>Contact</span>
          </button>
        </div>
      )}

      {/* Contact selector modal */}
      {showContactSelector && (
        <div className={styles.modalOverlay} onClick={() => setShowContactSelector(false)}>
          <div className={styles.contactSelectorModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Select Contact</h3>
              <button type="button" className={styles.modalCloseBtn} onClick={() => setShowContactSelector(false)}>✕</button>
            </div>
            <div className={styles.modalSearchBox}>
              <input type="text" className={styles.modalSearchInput} placeholder="Search by name..."
                value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} autoFocus />
            </div>
            <div className={styles.contactSelectorList}>
              {loadingContacts && contactOptions.length === 0 ? (
                <div className={styles.emptyState}>Loading…</div>
              ) : contactOptions.length === 0 ? (
                <div className={styles.emptyState}>No contacts found</div>
              ) : (
                contactOptions.map((c) => (
                  <div key={c.contactId} className={styles.contactSelectorItem}
                    onClick={() => {
                      const card = `👤 Contact Card:\nName: ${c.contactName}\nDetails: ${c.identifier ?? 'N/A'}`;
                      updateDraft({ body: draft.body + (draft.body ? '\n\n' : '') + card });
                      setShowContactSelector(false);
                    }}>
                    <div className={styles.selectorAvatar}>{c.contactName.charAt(0).toUpperCase()}</div>
                    <div className={styles.selectorInfo}>
                      <div className={styles.selectorName}>{c.contactName}</div>
                      {c.identifier && <div className={styles.selectorDetail}>{c.identifier}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.composer}>
        <button ref={paperclipBtnRef} type="button" className={styles.composerIconBtn}
          onClick={() => setShowAttachmentMenu((p) => !p)} disabled={isSending} title="Attach"
          style={{ opacity: isSending ? 0.4 : 1 }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={draft.body}
          onChange={(e) => { updateDraft({ body: e.target.value }); emitTyping(); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={channel === 'WHATSAPP' ? 'Type a message…' : 'Write an email draft…'}
          className={styles.composerTextarea}
          disabled={isSending}
        />

        <button className={styles.composerBtn} disabled={!canSend} onClick={handleSend}
          title={channel === 'EMAIL' ? 'Send (Ctrl+Enter)' : 'Send (Enter)'}>
          {isSending ? (
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : isUploading ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" style={{ transform: 'rotate(45deg)', marginLeft: '-2px' }}>
              <path d="M24 0l-6 22-8.129-7.239 7.802-8.234-10.458 7.227-7.215-1.754 24-12zm-15 16.668v7.332l3.258-4.431-3.258-2.901z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
