'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { uploadAttachment, UploadedAttachment } from '@/lib/upload';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'failed';

export interface UploadState {
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  error?: string;
  result?: UploadedAttachment;
  abortController: AbortController;
}

interface UseUploadReturn {
  uploads: UploadState[];
  addFiles: (files: FileList | File[]) => void;
  removeFile: (id: string) => void;
  retryFile: (id: string) => void;
  clearAll: () => void;
  isUploading: boolean;
  hasAttachments: boolean;
}

export function useUpload(draftId: string | null): UseUploadReturn {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const uploadsRef = useRef<UploadState[]>([]);

  const setAndSync = (updater: (prev: UploadState[]) => UploadState[]) => {
    setUploads((prev) => {
      const next = updater(prev);
      uploadsRef.current = next;
      return next;
    });
  };

  const runUpload = useCallback(
    async (id: string, file: File, abortController: AbortController) => {
      if (!draftId) return;

      setAndSync((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: 'uploading' } : u)),
      );

      try {
        const result = await uploadAttachment(
          draftId,
          file,
          (progress) => {
            setAndSync((prev) =>
              prev.map((u) => (u.id === id ? { ...u, progress } : u)),
            );
          },
          abortController.signal,
        );

        setAndSync((prev) =>
          prev.map((u) =>
            u.id === id ? { ...u, status: 'done', progress: 100, result } : u,
          ),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setAndSync((prev) => prev.filter((u) => u.id !== id));
        } else {
          setAndSync((prev) =>
            prev.map((u) =>
              u.id === id
                ? { ...u, status: 'failed', error: (err as Error).message }
                : u,
            ),
          );
        }
      }
    },
    [draftId],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const newUploads: UploadState[] = fileArray.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: 'pending' as UploadStatus,
        abortController: new AbortController(),
      }));

      setAndSync((prev) => [...prev, ...newUploads]);

      for (const upload of newUploads) {
        runUpload(upload.id, upload.file, upload.abortController);
      }
    },
    [runUpload],
  );

  const removeFile = useCallback((id: string) => {
    const upload = uploadsRef.current.find((u) => u.id === id);
    upload?.abortController.abort();
    setAndSync((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const retryFile = useCallback(
    (id: string) => {
      const upload = uploadsRef.current.find((u) => u.id === id);
      if (!upload || upload.status !== 'failed') return;
      const newController = new AbortController();
      setAndSync((prev) =>
        prev.map((u) =>
          u.id === id
            ? { ...u, status: 'pending', progress: 0, error: undefined, abortController: newController }
            : u,
        ),
      );
      runUpload(id, upload.file, newController);
    },
    [runUpload],
  );

  // Automatically trigger uploads for pending files once draftId becomes non-null
  useEffect(() => {
    if (!draftId) return;
    const pendingUploads = uploadsRef.current.filter((u) => u.status === 'pending');
    for (const upload of pendingUploads) {
      runUpload(upload.id, upload.file, upload.abortController);
    }
  }, [draftId, runUpload]);

  const clearAll = useCallback(() => {
    for (const u of uploadsRef.current) u.abortController.abort();
    setAndSync(() => []);
  }, []);

  const isUploading = uploads.some((u) => u.status === 'uploading' || u.status === 'pending');
  const hasAttachments = uploads.some((u) => u.status === 'done');

  return { uploads, addFiles, removeFile, retryFile, clearAll, isUploading, hasAttachments };
}
