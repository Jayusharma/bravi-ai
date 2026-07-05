'use client';

// ChatShell — the three-pane Discord-style layout:
//   [ChannelSidebar] | [TeamChatRoom (the open channel/DM)] | [ChannelDetailsPanel]
// Owns: the conversation list, which conversation is open, and the details toggle.
// Reacts to: conversationsVersion bumps (create/rename/members) → refetch list;
//            chat:membership:removed for the OPEN channel → route back to #general.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '@/contexts/SocketContext';
import { useToast } from '@/components/ui/Toast';
import { SOCKET_EVENTS } from '@/lib/socket-events';
import {
    getChatRoomMeta,
    listConversations,
    type ChatConversationSummary,
    type ChatRoom,
} from '@/services/chat/chat.service';
import { ChannelSidebar } from './ChannelSidebar';
import { ChannelDetailsPanel } from './ChannelDetailsPanel';
import { TeamChatRoom } from './TeamChatRoom';

export function ChatShell() {
    const toast = useToast();
    const { socket, conversationsVersion } = useSocket();

    const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [activeMeta, setActiveMeta] = useState<ChatRoom | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const generalId = useMemo(
        () => conversations.find((c) => c.key === 'COMMON_ROOM')?.id ?? null,
        [conversations],
    );

    // Load (and re-load) the sidebar list. Also picks the initial conversation.
    const refresh = useCallback(async () => {
        try {
            const list = await listConversations();
            setConversations(list);
            setLoaded(true);
            // First load, or the open conversation vanished (kicked/archived) → land on #general
            setActiveId((current) => {
                if (current && list.some((c) => c.id === current)) return current;
                return list.find((c) => c.key === 'COMMON_ROOM')?.id ?? list[0]?.id ?? null;
            });
        } catch {
            setLoaded(true);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh, conversationsVersion]);

    // Load the open conversation's metadata (name, role, description) for header + details panel
    useEffect(() => {
        if (!activeId) { setActiveMeta(null); return; }
        let active = true;
        getChatRoomMeta(activeId)
            .then((meta) => { if (active) setActiveMeta(meta); })
            .catch(() => { /* just removed — refresh() will reroute */ });
        return () => { active = false; };
    }, [activeId, conversationsVersion]);

    // Live kick for the channel I'M LOOKING AT → toast + route to #general.
    // (Badge/list cleanup happens in SocketContext for every case.)
    useEffect(() => {
        if (!socket) return;
        const onRemoved = (data: { conversationId: string }) => {
            setActiveId((current) => {
                if (current !== data.conversationId) return current;
                toast.info('Removed from channel', 'You no longer have access to that channel.');
                setShowDetails(false);
                return null; // refresh() below re-lands on #general
            });
        };
        socket.on(SOCKET_EVENTS.CHAT_MEMBERSHIP_REMOVED, onRemoved);
        return () => { socket.off(SOCKET_EVENTS.CHAT_MEMBERSHIP_REMOVED, onRemoved); };
    }, [socket, toast]);

    // activeId was cleared (kick/leave/archive) → re-resolve to #general
    useEffect(() => {
        if (loaded && activeId === null) refresh();
    }, [loaded, activeId, refresh]);

    const handleLeftChannel = useCallback(() => {
        setShowDetails(false);
        setActiveId(generalId); // leaving/archiving routes home to #general
        refresh();
    }, [generalId, refresh]);

    if (!loaded) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading chat…</div>;
    }

    return (
        <div className="flex h-full min-h-0">
            <ChannelSidebar
                conversations={conversations}
                activeId={activeId}
                generalId={generalId}
                onSelect={(id) => { setActiveId(id); setShowDetails(false); }}
                onRefresh={refresh}
            />

            <div className="flex min-w-0 flex-1 flex-col">
                {activeId ? (
                    // key = remount per conversation → all room state resets cleanly
                    <TeamChatRoom
                        key={activeId}
                        conversationId={activeId}
                        onOpenDetails={() => setShowDetails((p) => !p)}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Select a channel to start chatting.
                    </div>
                )}
            </div>

            {showDetails && activeMeta && (
                <ChannelDetailsPanel
                    room={activeMeta}
                    generalId={generalId}
                    onClose={() => setShowDetails(false)}
                    onChanged={refresh}
                    onLeft={handleLeftChannel}
                />
            )}
        </div>
    );
}
