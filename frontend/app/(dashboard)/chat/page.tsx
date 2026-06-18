'use client';

// Team Chat page — internal staff chat (single common room).
// Visual shell for now; data + real-time wiring lands in later steps.

import { TeamChatRoom } from '@/components/chat/TeamChatRoom';
import styles from '@/styles/TeamChat.module.css';

export default function ChatPage() {
  return (
    <div className={`${styles.page} teamChatPage`}>
      <TeamChatRoom />
    </div>
  );
}
