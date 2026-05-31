'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ContactList from '@/components/messaging/ContactList';
import ChatView from '@/components/messaging/ChatView';
import MessageToast, { type ToastMessage } from '@/components/messaging/MessageToast';
import type { ConversationPreview } from '@/services/messaging/chat.service';
import { getSocket, disconnectSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import styles from './messaging.module.css';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export default function MessagingPage() {
    const [activeConversation, setActiveConversation] = useState<ConversationPreview | null>(null);
    const [unreadContacts, setUnreadContacts] = useState<Record<string, number>>({});
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const socketRef = useRef<Socket | null>(null);
    const activeContactIdRef = useRef<string | null>(null);
    const conversationsRef = useRef<ConversationPreview[]>([]);

    // Keep ref in sync with state for use in socket callbacks
    useEffect(() => {
        activeContactIdRef.current = activeConversation?.contactId || null;
    }, [activeConversation]);

    // ── WebSocket connection lifecycle ──
    useEffect(() => {
        let mounted = true;

        async function connect() {
            try {
                setConnectionStatus('connecting');
                const sock = await getSocket();
                if (!mounted) return;

                socketRef.current = sock;
                setConnectionStatus('connected');

                // Track connection state changes
                sock.on('connect', () => {
                    if (mounted) setConnectionStatus('connected');
                });
                sock.on('disconnect', () => {
                    if (mounted) setConnectionStatus('disconnected');
                });

                // ── Global notification: for badges + toasts ──
                // This event is broadcast to ALL users (not room-specific)
                sock.on('notification:new-message', (data: {
                    contactId: string;
                    enquiryId: string;
                    messagePreview: string;
                    messageId: string;
                }) => {
                    if (!mounted) return;

                    // Only show badge + toast if NOT viewing this contact's chat
                    if (data.contactId !== activeContactIdRef.current) {
                        // Increment unread badge on sidebar
                        setUnreadContacts(prev => ({
                            ...prev,
                            [data.contactId]: (prev[data.contactId] || 0) + 1,
                        }));

                        // Show WhatsApp-style notification toast
                        const contactName = findContactName(data.contactId);
                        setToasts(prev => [
                            ...prev.slice(-4), // Keep max 5 toasts
                            {
                                id: data.messageId || `toast-${Date.now()}`,
                                contactName: contactName,
                                message: data.messagePreview || 'New message',
                                contactId: data.contactId,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                    // If chat IS open — no badge, no toast (user sees it live)
                });

                // ── Track contact list for name resolution ──
                sock.on('contact-list:update', (data: { conversations: ConversationPreview[] }) => {
                    if (!mounted) return;
                    conversationsRef.current = data.conversations;
                });

            } catch (err) {
                console.error('❌ Socket connection failed:', err);
                if (mounted) setConnectionStatus('disconnected');
            }
        }

        connect();

        return () => {
            mounted = false;
            socketRef.current?.off('connect');
            socketRef.current?.off('disconnect');
            socketRef.current?.off('notification:new-message');
            socketRef.current?.off('contact-list:update');
            disconnectSocket();
        };
    }, []);

    // ── Helper: find contact name from cached conversations ──
    const findContactName = (contactId: string): string => {
        const conv = conversationsRef.current.find(c => c.contactId === contactId);
        return conv?.contactName || 'New Message';
    };

    // ── Handle contact selection ──
    const handleSelectContact = useCallback((conv: ConversationPreview) => {
        setActiveConversation(conv);

        // Clear unread count for this contact
        setUnreadContacts(prev => {
            const next = { ...prev };
            delete next[conv.contactId];
            return next;
        });

        // Join the contact room — all real-time events (messages, outbound status, typing) come here
        socketRef.current?.emit('contact:join', { contactId: conv.contactId });
    }, []);

    // ── Handle notification click (jump to that chat) ──
    const handleToastClick = useCallback((contactId: string) => {
        const conv = conversationsRef.current.find(c => c.contactId === contactId);
        if (conv) {
            handleSelectContact(conv);
        }
    }, [handleSelectContact]);

    // ── Dismiss toast ──
    const handleDismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // ── Leave previous chat room when switching contacts ──
    const prevContactIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (prevContactIdRef.current && prevContactIdRef.current !== activeConversation?.contactId) {
            socketRef.current?.emit('contact:leave', { contactId: prevContactIdRef.current });
        }
        prevContactIdRef.current = activeConversation?.contactId || null;
    }, [activeConversation?.contactId]);

    // ── Update conversations ref on initial load too ──
    const handleConversationsLoaded = useCallback((convs: ConversationPreview[]) => {
        conversationsRef.current = convs;
    }, []);

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
            {/* Connection status banner */}
            {connectionStatus !== 'connected' && (
                <div className={`${styles.connectionBanner} ${styles[connectionStatus]}`}>
                    <span className={styles.connectionDot} />
                    {connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected — trying to reconnect'}
                </div>
            )}

            <div className={styles.messagingLayout} ref={layoutRef}>
                {/* Left panel: Resizable contact list */}
                <div
                    className={styles.contactPanel}
                    style={{ width: contactWidth }}
                >
                    <ContactList
                        activeContactId={activeConversation?.contactId || null}
                        onSelectContact={handleSelectContact}
                        unreadContacts={unreadContacts}
                        onConversationsLoaded={handleConversationsLoaded}
                    />
                </div>

                {/* Drag handle */}
                <div
                    className={styles.resizeHandle}
                    onMouseDown={handleMouseDown}
                />

                {/* Right panel: Chat view or empty state */}
                <div className={styles.chatPanel}>
                    {activeConversation ? (
                        <ChatView
                            key={activeConversation.contactId}
                            contactId={activeConversation.contactId}
                            contactName={activeConversation.contactName}
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

            {/* WhatsApp-style notification toasts */}
            <MessageToast
                toasts={toasts}
                onDismiss={handleDismissToast}
                onClickToast={handleToastClick}
            />
        </div>
    );
}
