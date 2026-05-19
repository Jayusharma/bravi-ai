'use client';

import { MessageChannel } from '@/services/messaging/outbound.service';
import { Button } from '@/components/ui/Button';

interface Props {
    open: boolean;
    channel: MessageChannel;
    recipient: string;
    subject?: string | null;
    bodyPreview: string;
    sending: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmSendDialog({
    open,
    channel,
    recipient,
    subject,
    bodyPreview,
    sending,
    onConfirm,
    onCancel,
}: Props) {
    if (!open) return null;

    const isEmail = channel === 'EMAIL';
    const channelLabel = isEmail ? 'Email' : 'WhatsApp';
    const channelIcon = isEmail ? '✉️' : '💬';

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div className="bg-background border border-border/60 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm mx-0 sm:mx-4 p-5 space-y-4 animate-slide-in-bottom">
                {/* Header */}
                <div className="flex items-center gap-2.5">
                    <span className="text-xl">{channelIcon}</span>
                    <div>
                        <h2 className="text-sm font-semibold">Send via {channelLabel}</h2>
                        <p className="text-xs text-muted-foreground">Review before sending</p>
                    </div>
                </div>

                {/* Preview card */}
                <div className="bg-muted/40 rounded-xl divide-y divide-border/50 text-sm overflow-hidden">
                    <div className="flex gap-3 px-3.5 py-2.5">
                        <span className="text-xs text-muted-foreground w-16 shrink-0 mt-0.5">To</span>
                        <span className="break-all font-medium text-foreground">{recipient}</span>
                    </div>
                    {isEmail && subject && (
                        <div className="flex gap-3 px-3.5 py-2.5">
                            <span className="text-xs text-muted-foreground w-16 shrink-0 mt-0.5">Subject</span>
                            <span className="text-foreground">{subject}</span>
                        </div>
                    )}
                    <div className="flex gap-3 px-3.5 py-2.5">
                        <span className="text-xs text-muted-foreground w-16 shrink-0 mt-0.5">Message</span>
                        <span className="line-clamp-4 text-muted-foreground leading-relaxed">{bodyPreview}</span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                    <Button variant="outline" onClick={onCancel} disabled={sending} className="flex-1">
                        Cancel
                    </Button>
                    <Button onClick={onConfirm} disabled={sending} className="flex-1">
                        {sending ? 'Sending…' : 'Send'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
