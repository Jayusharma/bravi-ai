'use client';

// ChannelSidebar — left pane of the Discord-style chat: CHANNELS + DIRECT MESSAGES
// sections with per-conversation unread badges. "+" on Channels opens Create
// (admins/managers only); "+" on DMs opens the people picker (everyone).

import { useState } from 'react';
import { PermissionGate } from '@/components/auth';
import { useToast } from '@/components/ui/Toast';
import { openDm, type ChatConversationSummary } from '@/services/chat/chat.service';
import { useAuthStore } from '@/stores/auth-store';
import { CreateChannelModal } from './CreateChannelModal';
import { PeoplePickerModal } from './PeoplePickerModal';

interface ChannelSidebarProps {
    conversations: ChatConversationSummary[];
    activeId: string | null;
    generalId: string | null; // roster source for the DM picker
    onSelect: (conversationId: string) => void;
    onRefresh: () => void; // refetch the list (after create / DM open)
}

function previewText(c: ChatConversationSummary): string {
    if (!c.lastMessage) return 'No messages yet';
    const name = c.lastMessage.senderName.split(' ')[0];
    const body = c.lastMessage.content ?? '📎 Attachment';
    return `${name}: ${body}`;
}

export function ChannelSidebar({ conversations, activeId, generalId, onSelect, onRefresh }: ChannelSidebarProps) {
    const toast = useToast();
    const currentUserId = useAuthStore((s) => s.user?.id ?? null);
    const chatUnreadByConversation: Record<string, number> = {};
    const [showCreate, setShowCreate] = useState(false);
    const [showDmPicker, setShowDmPicker] = useState(false);

    const channels = conversations.filter((c) => c.type === 'GROUP');
    const dms = conversations.filter((c) => c.type === 'DIRECT');

    // Live unread beats the fetched snapshot; fetched fills in before any socket event
    const unreadFor = (c: ChatConversationSummary) =>
        chatUnreadByConversation[c.id] ?? (c.id === activeId ? 0 : c.unreadCount);

    const handleOpenDm = async (userIds: string[]) => {
        try {
            const dm = await openDm(userIds[0]);
            setShowDmPicker(false);
            onRefresh();
            onSelect(dm.id); // same pair → same conversation, every time
        } catch (err) {
            toast.error('Could not open DM', err instanceof Error ? err.message : undefined);
        }
    };

    const renderRow = (c: ChatConversationSummary, isChannel: boolean) => {
        const unread = unreadFor(c);
        const isActive = c.id === activeId;
        return (
            <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    isActive ? 'bg-indigo-500/10 text-foreground' : 'hover:bg-accent/60 text-foreground/90'
                }`}
            >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    isChannel ? 'bg-accent/70 text-indigo-500' : 'bg-accent/70 text-muted-foreground'
                }`}>
                    {isChannel ? '#' : (c.name ?? '?').charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${unread > 0 ? 'font-bold' : 'font-medium'}`}>
                        {isChannel ? c.name : c.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{previewText(c)}</span>
                </span>
                {unread > 0 && (
                    <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold text-white">
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>
        );
    };

    return (
        <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border/40 bg-card/40">
            {/* CHANNELS section */}
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Channels</span>
                <PermissionGate action="create" subject="chatchannel">
                    <button
                        onClick={() => setShowCreate(true)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                        title="Create channel"
                        aria-label="Create channel"
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                </PermissionGate>
            </div>
            <div className="space-y-0.5 px-2">
                {channels.map((c) => renderRow(c, true))}
                {channels.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-muted-foreground">No channels yet.</p>
                )}
            </div>

            {/* DIRECT MESSAGES section */}
            <div className="flex items-center justify-between px-4 pb-1 pt-5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Direct Messages</span>
                <button
                    onClick={() => setShowDmPicker(true)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                    title="New direct message"
                    aria-label="New direct message"
                >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
            </div>
            <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
                {dms.map((c) => renderRow(c, false))}
                {dms.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-muted-foreground">No conversations yet.</p>
                )}
            </div>

            {showCreate && (
                <CreateChannelModal
                    onCreated={(channelId) => { onRefresh(); onSelect(channelId); }}
                    onClose={() => setShowCreate(false)}
                />
            )}

            {showDmPicker && generalId && (
                <PeoplePickerModal
                    title="New Direct Message"
                    confirmLabel="Start chat"
                    rosterConversationId={generalId}
                    excludeUserIds={currentUserId ? [currentUserId] : []}
                    onConfirm={handleOpenDm}
                    onClose={() => setShowDmPicker(false)}
                />
            )}
        </aside>
    );
}
