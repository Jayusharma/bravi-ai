'use client';

// CreateChannelModal — admins/managers create a named channel (Discord-style).
// Step 1: name + description. Members are added afterwards from the details
// panel ("Add People") — keeps this modal to one job.

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { createChannel } from '@/services/chat/chat.service';

interface CreateChannelModalProps {
    onCreated: (channelId: string) => void;
    onClose: () => void;
}

export function CreateChannelModal({ onCreated, onClose }: CreateChannelModalProps) {
    const toast = useToast();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const canSubmit = name.trim().length >= 2;

    const handleCreate = async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        try {
            const channel = await createChannel({
                name: name.trim(),
                description: description.trim() || undefined,
            });
            toast.success('Channel created', `#${name.trim()} is live — add people from the details panel.`);
            onCreated(channel.id);
            onClose();
        } catch (err) {
            toast.error('Create failed', err instanceof Error ? err.message : 'Could not create the channel.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="w-full max-w-sm overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                    <h3 className="text-base font-semibold">Create Channel</h3>
                    <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-4 p-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium">Channel name</label>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">#</span>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="sales-updates"
                                className="pl-7"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Description <span className="text-muted-foreground">(optional)</span></label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What is this channel about?"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleCreate} disabled={!canSubmit || submitting}>
                        {submitting ? 'Creating…' : 'Create Channel'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
