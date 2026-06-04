'use client';

// Messaging page: handles contact selection, room join/leave, and the resizable split-panel layout.
// Socket lifecycle is owned by SocketProvider (dashboard layout) — this page only uses the socket, never manages it.

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ContactList from '@/components/messaging/ContactList';
import ChatView from '@/components/messaging/ChatView';
import type { ConversationPreview } from '@/services/messaging/chat.service';
import { useSocket } from '@/contexts/SocketContext';
import { joinContactRoom, leaveContactRoom } from '@/lib/socket';
import styles from './messaging.module.css';

// useSearchParams requires a Suspense boundary in the Next.js App Router
export default function MessagingPage() {
    return (
        <Suspense>
            <MessagingPageInner />
        </Suspense>
    );
}

function MessagingPageInner() {
    const [activeConversation, setActiveConversation] = useState<ConversationPreview | null>(null);
    const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
    const [highlightEnquiryId, setHighlightEnquiryId] = useState<string | null>(null);
    const [highlightMessageChannel, setHighlightMessageChannel] = useState<'WHATSAPP' | 'EMAIL' | null>(null);
    const [highlightQuery, setHighlightQuery] = useState<string | null>(null);

    const activeContactIdRef = useRef<string | null>(null);
    const conversationsRef = useRef<ConversationPreview[]>([]);
    // Flag used to auto-select a contact when conversations finish loading (toast-navigation flow)
    const [conversationsLoaded, setConversationsLoaded] = useState(false);

    const searchParams = useSearchParams();
    const router = useRouter();

    // Pull shared state from SocketProvider — no local connect/disconnect
    const { unreadContacts, clearUnread, setActiveContactId, setConversations } = useSocket();

    // Keep ref in sync for use inside socket callbacks without causing re-renders
    useEffect(() => {
        activeContactIdRef.current = activeConversation?.contactId || null;
    }, [activeConversation]);

    // ── Contact selection ──
    const handleSelectContact = useCallback((
        conv: ConversationPreview,
        messageId?: string,
        enquiryId?: string,
        messageChannel?: 'WHATSAPP' | 'EMAIL',
        searchQuery?: string
    ) => {
        setActiveConversation(conv);
        setHighlightMessageId(messageId || null);
        setHighlightEnquiryId(enquiryId || null);
        setHighlightMessageChannel(messageChannel || null);
        setHighlightQuery(searchQuery || null);
        // Tell SocketProvider which contact is open so it suppresses badge + toast for it
        setActiveContactId(conv.contactId);
        clearUnread(conv.contactId);
    }, [clearUnread, setActiveContactId]);

    // Handle WebSocket room join/leave lifecycle (with auto-reconnect registry and unmount cleanup)
    useEffect(() => {
        const contactId = activeConversation?.contactId;
        if (!contactId) return;

        joinContactRoom(contactId);

        return () => {
            leaveContactRoom(contactId);
        };
    }, [activeConversation?.contactId]);

    // Clear activeContactId in SocketProvider when leaving this page
    useEffect(() => {
        return () => setActiveContactId(null);
    }, [setActiveContactId]);

    // ── Conversations loaded callback ──
    // Also feeds SocketProvider's name-lookup map used in notification toasts
    const handleConversationsLoaded = useCallback((convs: ConversationPreview[]) => {
        conversationsRef.current = convs;
        setConversations(convs);
        setConversationsLoaded(true);
    }, [setConversations]);

    // ── Toast-navigation auto-select ──
    // When SocketProvider routes here with ?contact=<id>, auto-select that contact once conversations are ready
    useEffect(() => {
        const contactParam = searchParams.get('contact');
        if (!contactParam || !conversationsLoaded) return;
        const conv = conversationsRef.current.find(c => c.contactId === contactParam);
        if (conv) {
            handleSelectContact(conv);
            router.replace('/messaging', { scroll: false }); // clean up URL param
        }
    }, [searchParams, conversationsLoaded, handleSelectContact, router]);

    // ── Resizable contact sidebar ──
    const [contactWidth, setContactWidth] = useState(360);
    const isResizing = useRef(false);
    const layoutRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const layoutLeft = layoutRef.current?.getBoundingClientRect().left || 0;

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isResizing.current) return;
            const newWidth = Math.min(550, Math.max(260, ev.clientX - layoutLeft));
            setContactWidth(newWidth);
        };

        const handleMouseUp = () => {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, []);

    return (
        <div className={styles.messagingPage}>
            <div className={styles.messagingLayout} ref={layoutRef}>
                {/* Left panel: Resizable contact list */}
                <div className={styles.contactPanel} style={{ width: contactWidth }}>
                    <ContactList
                        activeContactId={activeConversation?.contactId || null}
                        onSelectContact={handleSelectContact}
                        unreadContacts={unreadContacts}
                        onConversationsLoaded={handleConversationsLoaded}
                    />
                </div>

                {/* Drag handle */}
                <div className={styles.resizeHandle} onMouseDown={handleMouseDown} />

                {/* Right panel: Chat view or empty state */}
                <div className={styles.chatPanel}>
                    {activeConversation ? (
                        <ChatView
                            key={activeConversation.contactId}
                            contactId={activeConversation.contactId}
                            contactName={activeConversation.contactName}
                            highlightMessageId={highlightMessageId}
                            highlightEnquiryId={highlightEnquiryId}
                            highlightMessageChannel={highlightMessageChannel}
                            highlightQuery={highlightQuery}
                            onClearHighlight={() => {
                                setHighlightMessageId(null);
                                setHighlightEnquiryId(null);
                                setHighlightMessageChannel(null);
                                setHighlightQuery(null);
                            }}
                        />
                    ) : (
                        <div className={styles.emptyView}>
                            <span className={styles.emptyIcon}>💬</span>
                            <h3>Select a conversation</h3>
                            <p>Choose a contact from the list to view messages</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
