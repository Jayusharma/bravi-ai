'use client';

// ChannelToggle — the on/off switch. Purely presentational: the parent (ChannelsClient)
// owns the API call and loading state; this just renders the current value and reports clicks.

interface ChannelToggleProps {
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
}

export function ChannelToggle({ checked, disabled, onChange }: ChannelToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={onChange}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                checked ? 'bg-emerald-500' : 'bg-muted'
            }`}
        >
            <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    checked ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
        </button>
    );
}
