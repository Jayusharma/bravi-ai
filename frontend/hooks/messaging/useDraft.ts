'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createDraft, updateDraft, deleteDraft, getActiveDraft, deleteDraftAttachment, type OutboundDraft, type DraftAttachment } from '@/services/messaging/chat.service';
import { ERROR_MESSAGES } from '@/lib/error-messages';

const DEBOUNCE_MS = 2000;
const EXTEND_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type MessageChannel = 'WHATSAPP' | 'EMAIL' | 'SMS';

interface DraftState {
  id: string | null;
  body: string;
  subject: string;
  attachments: DraftAttachment[];
}

interface UseDraftReturn {
  draft: DraftState;
  updateDraft: (patch: { body?: string; subject?: string }) => void;
  discardDraft: () => Promise<void>;
  clearLocalDraftState: () => void;
  saveForLater: () => Promise<void>;
  /** Deletes an existing attachment from the draft (calls API + updates local state) */
  removeExistingAttachment: (attachmentId: string) => Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
}

/**
 * Manages per-enquiry draft state with 2s debounced auto-save,
 * unmount flush, and beforeunload flush.
 */
export function useDraft(enquiryId: string | null, channel: MessageChannel): UseDraftReturn {
  const [draft, setDraft] = useState<DraftState>({ id: null, body: '', subject: '', attachments: [] });
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftIdRef = useRef<string | null>(null);
  const pendingPatch = useRef<{ body?: string; subject?: string } | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushInFlight = useRef(false);

  // Reset and load draft when enquiryId or channel changes
  useEffect(() => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    draftIdRef.current = null;
    pendingPatch.current = null;
    setDraft({ id: null, body: '', subject: '', attachments: [] });
    setIsDirty(false);
    setSaveError(null);

    if (!enquiryId) return;

    let cancelled = false;
    (async () => {
      try {
        const existing = await getActiveDraft(enquiryId);
        if (cancelled) return;
        if (existing && existing.channel === channel && existing.status === 'ACTIVE') {
          draftIdRef.current = existing.id;
          setDraft({
            id: existing.id,
            body: existing.body ?? '',
            subject: existing.subject ?? '',
            attachments: existing.attachments ?? [],
          });
        }
      } catch {
        // Non-blocking — draft restore failure is acceptable
      }
    })();

    return () => { cancelled = true; };
  }, [enquiryId, channel]);

  // Flush pending save — called on unmount and beforeunload
  const flush = useCallback(async () => {
    if (!pendingPatch.current || !enquiryId || flushInFlight.current) return;
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    const patch = pendingPatch.current;
    pendingPatch.current = null;
    flushInFlight.current = true;
    try {
      await persistPatch(enquiryId, channel, patch);
    } catch {
      // Silent — best-effort on unmount
    } finally {
      flushInFlight.current = false;
    }
  }, [enquiryId, channel]);

  // Persist a patch to the backend (create or update)
  const persistPatch = useCallback(async (
    eid: string,
    ch: MessageChannel,
    patch: { body?: string; subject?: string },
  ) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (draftIdRef.current) {
        await updateDraft(draftIdRef.current, { channel: ch, ...patch });
      } else {
        const created = await createDraft(eid, { channel: ch, ...patch });
        draftIdRef.current = created.id;
        setDraft(prev => ({ ...prev, id: created.id }));
      }
      setIsDirty(false);
    } catch {
      setSaveError(ERROR_MESSAGES.DRAFT_SAVE_FAILED);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Register beforeunload flush
  useEffect(() => {
    const handler = () => { flush(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flush]);

  // Flush on unmount
  useEffect(() => {
    return () => { flush(); };
  }, [flush]);

  // Update draft state and schedule debounced save
  const updateDraftFn = useCallback((patch: { body?: string; subject?: string }) => {
    setDraft(prev => {
      const nextBody = patch.body !== undefined ? patch.body : prev.body;
      const nextSubject = patch.subject !== undefined ? patch.subject : prev.subject;

      // Dispatch local event to sync draft preview in contact list instantly
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('draft-updated', {
          detail: {
            enquiryId,
            body: nextBody,
            attachmentCount: prev.attachments.length,
          }
        }));
      }, 0);

      return {
        ...prev,
        body: nextBody,
        subject: nextSubject,
      };
    });
    setIsDirty(true);
    pendingPatch.current = { ...pendingPatch.current, ...patch };

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      if (!enquiryId || !pendingPatch.current) return;
      const toSave = pendingPatch.current;
      pendingPatch.current = null;
      await persistPatch(enquiryId, channel, toSave);
    }, DEBOUNCE_MS);
  }, [enquiryId, channel, persistPatch]);

  const discardDraftFn = useCallback(async () => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    pendingPatch.current = null;
    if (draftIdRef.current) {
      try { await deleteDraft(draftIdRef.current); } catch { /* silent */ }
    }
    draftIdRef.current = null;
    setDraft({ id: null, body: '', subject: '', attachments: [] });
    setIsDirty(false);

    // Dispatch local event to clear draft preview in contact list instantly
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('draft-updated', {
        detail: {
          enquiryId,
          body: '',
          attachmentCount: 0,
        }
      }));
    }, 0);
  }, [enquiryId]);

  const clearLocalDraftStateFn = useCallback(() => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    pendingPatch.current = null;
    draftIdRef.current = null;
    setDraft({ id: null, body: '', subject: '', attachments: [] });
    setIsDirty(false);

    // Dispatch local event to clear draft preview in contact list instantly
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('draft-updated', {
        detail: {
          enquiryId,
          body: '',
          attachmentCount: 0,
        }
      }));
    }, 0);
  }, [enquiryId]);

  const saveForLaterFn = useCallback(async () => {
    if (!enquiryId) return;
    // Flush any pending changes first
    if (pendingPatch.current) {
      if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
      const patch = pendingPatch.current;
      pendingPatch.current = null;
      await persistPatch(enquiryId, channel, patch);
    }
    if (draftIdRef.current) {
      // Call create with saveForLater flag to extend expiry on server
      try {
        await createDraft(enquiryId, { channel, body: draft.body, subject: draft.subject, saveForLater: true });
      } catch { /* silent */ }
    }
  }, [enquiryId, channel, draft.body, draft.subject, persistPatch]);

  /** Deletes an existing attachment: calls backend DELETE and removes from local draft.attachments */
  const removeExistingAttachment = useCallback(async (attachmentId: string) => {
    if (!draftIdRef.current) return;
    try {
      await deleteDraftAttachment(draftIdRef.current, attachmentId);
    } catch { /* silent — row may already be gone */ }
    // Always update local state so the optimistic message won't include the removed attachment
    setDraft((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.id !== attachmentId),
    }));
  }, []);

  return {
    draft,
    updateDraft: updateDraftFn,
    discardDraft: discardDraftFn,
    clearLocalDraftState: clearLocalDraftStateFn,
    saveForLater: saveForLaterFn,
    removeExistingAttachment,
    isDirty,
    isSaving,
    saveError,
  };
}
