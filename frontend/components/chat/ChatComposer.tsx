'use client';

// ChatComposer — internal team-chat message input.
// VISUAL SHELL ONLY: local state for the textarea + attachment previews.
// No socket, no upload API, no draft autosave yet — that gets wired in a later step.

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '@/styles/TeamChat.module.css';

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null; // object URL for images, null otherwise
}

const MAX_ATTACHMENTS = 20;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📄';
  return '📎';
}

export function ChatComposer() {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [showMenu, setShowMenu] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const paperclipRef = useRef<HTMLButtonElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea to fit content (cap at 120px → scroll)
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  // Revoke object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the attachment menu on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        paperclipRef.current && !paperclipRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    setAttachments((prev) => {
      const next = [...prev];
      for (const file of arr) {
        if (next.length >= MAX_ATTACHMENTS) break;
        next.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        });
      }
      return next;
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  // Visual-only: clears local state. No network call yet.
  const handleSend = useCallback(() => {
    if (!canSend) return;
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    setText('');
    setAttachments([]);
  }, [canSend, attachments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  return (
    <div className={styles.composerWrapper}>
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className={styles.previewRow}>
          {attachments.map((att) => (
            <div key={att.id} className={styles.previewCard}>
              {att.previewUrl ? (
                <img src={att.previewUrl} alt={att.file.name} className={styles.previewImage} />
              ) : (
                <div className={styles.previewFile}>
                  <span className={styles.previewFileIcon}>{fileIcon(att.file.type)}</span>
                  <span className={styles.previewFileName}>{att.file.name}</span>
                  <span className={styles.previewFileSize}>{formatSize(att.file.size)}</span>
                </div>
              )}
              <button
                type="button"
                className={styles.previewRemove}
                onClick={() => removeAttachment(att.id)}
                aria-label="Remove attachment"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = ''; } }}
      />
      <input
        ref={documentInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.rar"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = ''; } }}
      />

      {/* Attachment popover menu */}
      {showMenu && (
        <div ref={menuRef} className={styles.attachmentMenu}>
          <button
            type="button"
            className={styles.attachmentMenuItem}
            onClick={() => { photoInputRef.current?.click(); setShowMenu(false); }}
          >
            <span className={`${styles.iconCircle} ${styles.iconPhotos}`}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 15-5-5L5 21" />
              </svg>
            </span>
            <span>Photos &amp; videos</span>
          </button>
          <button
            type="button"
            className={styles.attachmentMenuItem}
            onClick={() => { documentInputRef.current?.click(); setShowMenu(false); }}
          >
            <span className={`${styles.iconCircle} ${styles.iconDocument}`}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
            <span>Document</span>
          </button>
        </div>
      )}

      {/* Input row */}
      <div className={styles.composer}>
        <button
          ref={paperclipRef}
          type="button"
          className={styles.iconBtn}
          onClick={() => setShowMenu((p) => !p)}
          title="Attach"
          aria-label="Attach file"
        >
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32a1.5 1.5 0 0 1-2.121-2.121l7.81-7.81" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message…"
          className={styles.textarea}
          rows={1}
        />

        <button
          type="button"
          className={styles.sendBtn}
          disabled={!canSend}
          onClick={handleSend}
          title="Send (Enter)"
          aria-label="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
