'use client';

import { useEffect, useRef, useState } from 'react';
import { UploadState } from '@/hooks/messaging/useUpload';
import { formatFileSize } from '@/lib/upload';
import type { DraftAttachment } from '@/services/messaging/chat.service';

interface AttachmentPreviewProps {
  uploads: UploadState[];
  existingAttachments?: DraftAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onRemoveExisting?: (attachmentId: string) => void;
  onPreview?: (src: string, fileName: string) => void;
}

const FILE_ICON: Record<string, string> = {
  'image/': '🖼️',
  'video/': '🎬',
  'audio/': '🎵',
  'application/pdf': '📄',
  'application/': '📎',
};

function getIcon(mime: string) {
  for (const [prefix, icon] of Object.entries(FILE_ICON)) {
    if (mime.startsWith(prefix)) return icon;
  }
  return '📎';
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageThumb({ file, onClick }: { file: File; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    urlRef.current = objectUrl;
    setUrl(objectUrl);
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [file]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt={file.name}
      onClick={onClick}
      style={{
        width: '120px',
        height: '90px',
        objectFit: 'cover',
        display: 'block',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '6px 6px 0 0',
      }}
    />
  );
}

const cardStyle = (isImage: boolean, isFailed: boolean): React.CSSProperties => ({
  position: 'relative',
  width: isImage ? '120px' : '180px',
  background: 'rgba(255,255,255,0.05)',
  borderRadius: '8px',
  border: `1px solid ${isFailed ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
  overflow: 'hidden',
  flexShrink: 0,
});

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute',
        top: '4px',
        right: '4px',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.6)',
        border: 'none',
        color: '#fff',
        fontSize: '0.7rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.8)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.6)')}
    >
      ✕
    </button>
  );
}

export function AttachmentPreview({
  uploads,
  existingAttachments = [],
  onRemove,
  onRetry,
  onRemoveExisting,
  onPreview,
}: AttachmentPreviewProps) {
  if (uploads.length === 0 && existingAttachments.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      padding: '10px 14px',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      {/* Already-uploaded attachments from restored draft */}
      {existingAttachments.map((att) => {
        const isImage = att.kind === 'IMAGE';
        return (
          <div key={att.id} style={cardStyle(isImage, false)}>
            {isImage && att.cdnUrl ? (
              <img
                src={att.cdnUrl}
                alt={att.fileName}
                onClick={() => onPreview?.(att.cdnUrl!, att.fileName)}
                style={{
                  width: '120px',
                  height: '90px',
                  objectFit: 'cover',
                  display: 'block',
                  cursor: 'pointer',
                  borderRadius: '6px 6px 0 0',
                }}
              />
            ) : (
              <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '1.4rem' }}>{getIcon(att.mimeType)}</span>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '155px' }}>
                  {att.fileName}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>
                  {fmtSize(att.fileSize)}
                </span>
              </div>
            )}
            {/* Done checkmark */}
            <div style={{
              position: 'absolute', top: '4px', left: '6px', fontSize: '0.7rem', color: '#22c55e',
              fontWeight: 700, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: '16px', height: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✓</div>
            <RemoveBtn onClick={() => onRemoveExisting?.(att.id)} />
          </div>
        );
      })}

      {/* In-progress / new uploads */}
      {uploads.map((upload) => {
        const isImage = upload.file.type.startsWith('image/');
        return (
          <div key={upload.id} style={cardStyle(isImage, upload.status === 'failed')}>
            {isImage ? (
              <ImageThumb
                file={upload.file}
                onClick={upload.result?.cdnUrl && onPreview
                  ? () => onPreview(upload.result!.cdnUrl, upload.file.name)
                  : undefined}
              />
            ) : (
              <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '1.4rem' }}>{getIcon(upload.file.type)}</span>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '155px' }}>
                  {upload.file.name}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>
                  {fmtSize(upload.file.size)}
                </span>
              </div>
            )}

            {/* Progress bar */}
            {(upload.status === 'uploading' || upload.status === 'pending') && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(255,255,255,0.1)' }}>
                <div style={{ height: '100%', width: `${upload.progress}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', transition: 'width 0.2s' }} />
              </div>
            )}

            {/* Done overlay */}
            {upload.status === 'done' && (
              <div style={{
                position: 'absolute', top: '4px', left: '6px', fontSize: '0.7rem', color: '#22c55e',
                fontWeight: 700, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: '16px', height: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✓</div>
            )}

            {/* Error + retry */}
            {upload.status === 'failed' && (
              <button
                onClick={() => onRetry(upload.id)}
                style={{
                  position: 'absolute', inset: 0, background: 'rgba(239,68,68,0.15)', border: 'none',
                  cursor: 'pointer', fontSize: '0.7rem', color: '#fca5a5', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: '4px',
                }}
              >
                ↺ Retry
              </button>
            )}

            <RemoveBtn onClick={() => onRemove(upload.id)} />
          </div>
        );
      })}
    </div>
  );
}
