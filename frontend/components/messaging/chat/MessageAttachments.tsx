'use client';

import styles from '@/styles/ContactList.module.css';
import type { MessageAttachment } from '@/services/messaging/chat.service';

const DOC_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/vnd.ms-excel': '📊',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'text/csv': '📊',
  'text/plain': '📄',
  'application/zip': '📦',
  'application/x-rar-compressed': '📦',
};

function getDocIcon(mimeType: string): string { return DOC_ICONS[mimeType] ?? '📎'; }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  onImageClick?: (src: string, fileName: string) => void;
}

/** Renders image grid, videos, audio, and document attachments for a message bubble */
export function MessageAttachments({ attachments, onImageClick }: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === 'IMAGE');
  const videos = attachments.filter((a) => a.kind === 'VIDEO');
  const audios = attachments.filter((a) => a.kind === 'AUDIO' || a.kind === 'VOICE_NOTE');
  const docs = attachments.filter((a) => a.kind === 'DOCUMENT');

  return (
    <div className={styles.msgAttachments}>
      {images.length > 0 && (
        <div className={images.length === 1 ? styles.msgImageSingle : styles.msgImageGrid}>
          {images.map((img) => (
            <button key={img.id} type="button" className={styles.msgImageLink}
              onClick={() => onImageClick?.(img.cdnUrl ?? '', img.fileName)}>
              <img src={img.cdnUrl ?? ''} alt={img.fileName}
                className={styles.msgImageAttachment} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {videos.map((vid) => (
        <div key={vid.id} className={styles.msgVideoAttachment}>
          <video src={vid.cdnUrl ?? ''} controls preload="metadata" className={styles.msgVideoPlayer} />
        </div>
      ))}
      {audios.map((aud) => (
        <div key={aud.id} className={styles.msgAudioAttachment}>
          <audio src={aud.cdnUrl ?? ''} controls preload="metadata" className={styles.msgAudioPlayer} />
          <span className={styles.msgAudioName}>{aud.fileName}</span>
        </div>
      ))}
      {docs.map((doc) => (
        <div key={doc.id} className={styles.msgDocAttachment}>
          <span className={styles.msgDocIcon}>{getDocIcon(doc.mimeType)}</span>
          <div className={styles.msgDocInfo}>
            <span className={styles.msgDocName}>{doc.fileName}</span>
            <span className={styles.msgDocSize}>{fmtSize(doc.fileSize)}</span>
          </div>
          <div className={styles.msgDocActions}>
            <a href={doc.cdnUrl ?? '#'} target="_blank" rel="noopener noreferrer"
              className={styles.msgDocBtn}>↗ Open</a>
            <a href={doc.cdnUrl ?? '#'} download={doc.fileName}
              className={styles.msgDocBtn}>↓ Download</a>
          </div>
        </div>
      ))}
    </div>
  );
}
