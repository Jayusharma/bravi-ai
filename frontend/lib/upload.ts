'use client';

import { API } from './endpoints';

export interface UploadedAttachment {
  attachmentId: string;
  cdnUrl: string;
  kind: string;
  fileName: string;
  fileSize: number;
}

const MAX_SIZES: Record<string, number> = {
  'image/': 20 * 1024 * 1024,
  'video/': 100 * 1024 * 1024,
  'audio/': 50 * 1024 * 1024,
  'application/': 50 * 1024 * 1024,
};

export function getMaxSize(mimeType: string): number {
  for (const [prefix, limit] of Object.entries(MAX_SIZES)) {
    if (mimeType.startsWith(prefix)) return limit;
  }
  return 50 * 1024 * 1024;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload a file to a draft using XMLHttpRequest for progress tracking.
 * Uses AbortSignal for cancellation.
 */
export async function uploadAttachment(
  draftId: string,
  file: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<UploadedAttachment> {
  const maxSize = getMaxSize(file.type);
  if (file.size > maxSize) {
    throw new Error(`File too large. Maximum size is ${formatFileSize(maxSize)}.`);
  }

  const formData = new FormData();
  formData.append('file', file);

  // Fetch token for auth header
  const tokenRes = await fetch('/api/socket');
  const { token } = await tokenRes.json();

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const url = `${backendUrl}/api/v1${API.OUTBOUND.UPLOAD_ATTACHMENT(draftId)}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          // Unwrap ResponseInterceptor envelope if present
          resolve(data.data ?? data);
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));

    signal.addEventListener('abort', () => xhr.abort());

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}
