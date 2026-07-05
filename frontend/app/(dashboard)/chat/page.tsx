'use client';

// Team Chat page — Discord-style: channels + DMs sidebar, the open room, details panel.
// All state lives in ChatShell; this page is just the route mount.

import { ChatShell } from '@/components/chat/ChatShell';
import styles from '@/styles/TeamChat.module.css';

export default function ChatPage() {
  return (
    <div className={`${styles.page} teamChatPage`}>
      <ChatShell />
    </div>
  );
}
