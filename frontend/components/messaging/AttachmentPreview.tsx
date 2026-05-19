'use client';

import { UploadState } from '@/hooks/useUpload';
import { formatFileSize } from '@/lib/upload';

interface AttachmentPreviewProps {
  uploads: UploadState[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
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

export function AttachmentPreview({ uploads, onRemove, onRetry }: AttachmentPreviewProps) {
  if (uploads.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      padding: '8px 14px',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      {uploads.map((upload) => {
        const isImage = upload.file.type.startsWith('image/');
        const objectUrl = isImage && upload.status !== 'failed'
          ? URL.createObjectURL(upload.file)
          : null;

        return (
          <div
            key={upload.id}
            style={{
              position: 'relative',
              width: isImage ? '80px' : '140px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '8px',
              border: `1px solid ${upload.status === 'failed' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {/* Preview */}
            {isImage && objectUrl ? (
              <img
                src={objectUrl}
                alt={upload.file.name}
                style={{ width: '80px', height: '60px', objectFit: 'cover', display: 'block' }}
                onLoad={() => URL.revokeObjectURL(objectUrl)}
              />
            ) : (
              <div style={{
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}>
                <span style={{ fontSize: '1.2rem' }}>{getIcon(upload.file.type)}</span>
                <span style={{
                  fontSize: '0.65rem',
                  color: 'rgba(255,255,255,0.7)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '120px',
                }}>
                  {upload.file.name}
                </span>
                <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)' }}>
                  {formatFileSize(upload.file.size)}
                </span>
              </div>
            )}

            {/* Progress bar */}
            {(upload.status === 'uploading' || upload.status === 'pending') && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '3px',
                background: 'rgba(255,255,255,0.1)',
              }}>
                <div style={{
                  height: '100%',
                  width: `${upload.progress}%`,
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  transition: 'width 0.2s',
                }} />
              </div>
            )}

            {/* Done overlay */}
            {upload.status === 'done' && (
              <div style={{
                position: 'absolute',
                top: '2px',
                left: '4px',
                fontSize: '0.6rem',
                color: '#22c55e',
                fontWeight: 700,
              }}>✓</div>
            )}

            {/* Error + retry */}
            {upload.status === 'failed' && (
              <button
                onClick={() => onRetry(upload.id)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(239,68,68,0.15)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.65rem',
                  color: '#fca5a5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                }}
              >
                ↺ Retry
              </button>
            )}

            {/* Remove button */}
            <button
              onClick={() => onRemove(upload.id)}
              style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                color: '#fff',
                fontSize: '0.65rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
