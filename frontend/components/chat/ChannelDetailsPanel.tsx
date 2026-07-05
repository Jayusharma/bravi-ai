'use client';

// ChannelDetailsPanel — right pane: channel name/description, members list with
// presence, Add People (channel admin), edit/archive (channel admin), leave.
// The #general channel (key COMMON_ROOM) is org-wide: no leave, no archive.

import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth-store';
import {
    addChannelMembers,
    getChatMembers,
    removeChannelMember,
    updateChannel,
    type ChatMember,
    type ChatRoom,
} from '@/services/chat/chat.service';
import { PeoplePickerModal } from './PeoplePickerModal';

interface ChannelDetailsPanelProps {
    room: ChatRoom; // meta of the open conversation
    generalId: string | null; // roster source for Add People
    onClose: () => void;
    onChanged: () => void; // name/desc/members/archive changed → shell refreshes
    onLeft: () => void; // I left this channel → shell routes to #general
}

export function ChannelDetailsPanel({ room, generalId, onClose, onChanged, onLeft }: ChannelDetailsPanelProps) {
    const toast = useToast();
    const currentUserId = useAuthStore((s) => s.user?.id ?? null);

    const [members, setMembers] = useState<ChatMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddPeople, setShowAddPeople] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState(room.name ?? '');
    const [editDescription, setEditDescription] = useState(room.description ?? '');
    const [busy, setBusy] = useState(false);

    const isGeneral = room.key === 'COMMON_ROOM';
    const isDm = room.type === 'DIRECT';
    const isChannelAdmin = room.myRole === 'ADMIN';

    const loadMembers = useCallback(() => {
        getChatMembers(room.id)
            .then(setMembers)
            .catch(() => { /* not a member anymore */ })
            .finally(() => setLoading(false));
    }, [room.id]);

    useEffect(() => { loadMembers(); }, [loadMembers]);

    const handleAddPeople = async (userIds: string[]) => {
        try {
            const updated = await addChannelMembers(room.id, userIds);
            setMembers(updated);
            setShowAddPeople(false);
            toast.success('People added');
            onChanged();
        } catch (err) {
            toast.error('Add failed', err instanceof Error ? err.message : undefined);
        }
    };

    const handleRemove = async (member: ChatMember) => {
        if (!window.confirm(`Remove ${member.displayName || member.userName} from this channel?`)) return;
        try {
            await removeChannelMember(room.id, member.userId);
            setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
            toast.success('Member removed');
            onChanged();
        } catch (err) {
            toast.error('Remove failed', err instanceof Error ? err.message : undefined);
        }
    };

    const handleLeave = async () => {
        if (!currentUserId) return;
        if (!window.confirm(`Leave #${room.name}? You'll need to be re-added to see it again.`)) return;
        try {
            await removeChannelMember(room.id, currentUserId);
            onLeft();
        } catch (err) {
            toast.error('Leave failed', err instanceof Error ? err.message : undefined);
        }
    };

    const handleSaveEdit = async () => {
        if (busy || editName.trim().length < 2) return;
        setBusy(true);
        try {
            await updateChannel(room.id, {
                name: editName.trim(),
                description: editDescription.trim(),
            });
            setEditing(false);
            toast.success('Channel updated');
            onChanged();
        } catch (err) {
            toast.error('Update failed', err instanceof Error ? err.message : undefined);
        } finally {
            setBusy(false);
        }
    };

    const handleArchive = async () => {
        if (!window.confirm(`Archive #${room.name}? It becomes read-only and leaves everyone's sidebar.`)) return;
        try {
            await updateChannel(room.id, { archived: true });
            toast.success('Channel archived');
            onLeft(); // route away — it's gone from the sidebar
        } catch (err) {
            toast.error('Archive failed', err instanceof Error ? err.message : undefined);
        }
    };

    const onlineCount = members.filter((m) => m.isOnline).length;

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border/40 bg-card/40">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                <h3 className="text-sm font-bold">Channel Details</h3>
                <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Close details">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {/* Identity */}
                <div className="mb-5">
                    {editing ? (
                        <div className="space-y-2">
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Channel name" />
                            <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description" />
                            <div className="flex gap-2">
                                <Button onClick={handleSaveEdit} disabled={busy} className="h-8 px-3 text-xs">Save</Button>
                                <Button variant="outline" onClick={() => setEditing(false)} className="h-8 px-3 text-xs">Cancel</Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-2">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-lg font-bold text-indigo-500">
                                    {isDm ? (room.name ?? '?').charAt(0).toUpperCase() : '#'}
                                </span>
                                <h4 className="text-base font-bold">{isDm ? room.name : `# ${room.name}`}</h4>
                                {isChannelAdmin && !isDm && (
                                    <button onClick={() => { setEditName(room.name ?? ''); setEditDescription(room.description ?? ''); setEditing(true); }}
                                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" title="Edit channel" aria-label="Edit channel">
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            {room.description ? (
                                <p className="mt-2 text-sm text-muted-foreground">{room.description}</p>
                            ) : null}
                        </>
                    )}
                </div>

                {/* Members */}
                {!isDm && (
                    <div className="mb-5">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Members ({members.length}) · {onlineCount} online
                            </span>
                        </div>
                        {loading ? (
                            <p className="text-xs text-muted-foreground">Loading…</p>
                        ) : (
                            <div className="space-y-1">
                                {members.map((m) => (
                                    <div key={m.userId} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                                        <div className="relative">
                                            <Avatar fallback={m.displayName || m.userName} size="sm" />
                                            {m.isOnline && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">
                                                {m.displayName || m.userName}
                                                {m.userId === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                                            </div>
                                            <div className="text-[11px] text-muted-foreground">{m.role}</div>
                                        </div>
                                        {isChannelAdmin && !isGeneral && m.userId !== currentUserId && (
                                            <button
                                                onClick={() => handleRemove(m)}
                                                className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 cursor-pointer"
                                                title="Remove from channel"
                                                aria-label={`Remove ${m.displayName || m.userName}`}
                                            >
                                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {isChannelAdmin && !isGeneral && (
                            <button
                                onClick={() => setShowAddPeople(true)}
                                className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground cursor-pointer"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" />
                                </svg>
                                Add People
                            </button>
                        )}
                    </div>
                )}

                {/* Danger zone */}
                {!isDm && !isGeneral && (
                    <div className="space-y-1 border-t border-border/40 pt-3">
                        {isChannelAdmin && (
                            <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-amber-600 transition-colors hover:bg-amber-500/10 cursor-pointer dark:text-amber-400">
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" />
                                </svg>
                                Archive Channel
                            </button>
                        )}
                        <button onClick={handleLeave} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 cursor-pointer">
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" />
                            </svg>
                            Leave Channel
                        </button>
                    </div>
                )}
            </div>

            {showAddPeople && generalId && (
                <PeoplePickerModal
                    title="Add People"
                    confirmLabel="Add"
                    multi
                    rosterConversationId={generalId}
                    excludeUserIds={members.map((m) => m.userId)}
                    onConfirm={handleAddPeople}
                    onClose={() => setShowAddPeople(false)}
                />
            )}
        </aside>
    );
}
