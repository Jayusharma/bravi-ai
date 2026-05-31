'use client';

/** Shows saving state and a "Save for later" action above the composer */
interface DraftStatusIndicatorProps {
  isSaving: boolean;
  isDirty: boolean;
  saveError: string | null;
  onSaveForLater: () => void;
  hasDraft: boolean;
}

export function DraftStatusIndicator({
  isSaving,
  isDirty,
  saveError,
  onSaveForLater,
  hasDraft,
}: DraftStatusIndicatorProps) {
  if (saveError) {
    return (
      <div style={{ fontSize: '0.7rem', color: '#ef4444', padding: '2px 4px' }}>
        {saveError}
      </div>
    );
  }

  return null;
}
