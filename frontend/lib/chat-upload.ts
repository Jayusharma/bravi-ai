'use client';

// chat-upload.ts — uploads a team-chat attachment with progress tracking.
// Mirrors lib/upload.ts (the enquiry-draft uploader) but targets the chat endpoint:
// POST /chat/room/:conversationId/attachments → returns a descriptor that the
// composer passes to sendChatMessage() to attach it to the message.

import { API } from './endpoints';
import { getMaxSize, formatFileSize } from './upload';
import type { ChatAttachmentDescriptor } from '@/services/chat/chat.service';

/** Upload one file for a chat message. XHR (not fetch) so we get progress events. */
export async function uploadChatAttachment(
  conversationId: string,
  file: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<ChatAttachmentDescriptor> {
  const maxSize = getMaxSize(file.type);
  if (file.size > maxSize) {
    throw new Error(`File too large. Maximum size is ${formatFileSize(maxSize)}.`);
  }

  const formData = new FormData();
  formData.append('file', file);

  // Same auth pattern as lib/upload.ts — short-lived JWT from the Next route
  const tokenRes = await fetch('/api/socket');
  const { token } = await tokenRes.json();

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const url = `${backendUrl}/api/v1${API.CHAT.UPLOAD(conversationId)}`;

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
