'use client';

import { MessageChannel } from '@/services/messaging/outbound.service';

interface Props {
    value: MessageChannel;
    onChange: (channel: MessageChannel) => void;
    disabled?: boolean;
}

const CHANNELS: { value: MessageChannel; label: string; icon: string }[] = [
    { value: 'EMAIL', label: 'Email', icon: '✉️' },
    { value: 'WHATSAPP', label: 'WhatsApp', icon: '💬' },
];

export function ChannelSelector({ value, onChange, disabled }: Props) {
    return (
        <div className="flex gap-2">
            {CHANNELS.map((ch) => (
                <button
                    key={ch.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(ch.value)}
                    className={[
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                        value === ch.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-input bg-background hover:bg-accent',
                        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                >
                    <span>{ch.icon}</span>
                    {ch.label}
                </button>
            ))}
        </div>
    );
}
