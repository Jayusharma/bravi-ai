'use client';

// MembersSidebar — slide-in panel listing the room's members with name, role, and presence.

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { getChatMembers, type ChatMember } from '@/services/chat/chat.service';
import styles from '@/styles/TeamChat.module.css';

interface MembersSidebarProps {
  roomId: string;
  onClose: () => void;
}

export function MembersSidebar({ roomId, onClose }: MembersSidebarProps) {
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getChatMembers(roomId);
        if (active) setMembers(data);
      } catch {
        if (active) setError('Could not load members.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [roomId]);

  const onlineCount = members.filter((m) => m.isOnline).length;

  return (
    <>
      <div className={styles.membersBackdrop} onClick={onClose} />
      <aside className={styles.membersDrawer} role="dialog" aria-label="Members">
        <div className={styles.membersHeader}>
          <div>
            <p className={styles.membersTitle}>Members</p>
            <p className={styles.membersSubtitle}>
              {members.length} member{members.length === 1 ? '' : 's'} · {onlineCount} online
            </p>
          </div>
          <button className={styles.membersClose} onClick={onClose} aria-label="Close">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.memberList}>
          {loading ? (
            <div className={styles.membersNote}>Loading…</div>
          ) : error ? (
            <div className={styles.membersNote}>{error}</div>
          ) : members.length === 0 ? (
            <div className={styles.membersNote}>No members yet.</div>
          ) : (
            members.map((m) => {
              const name = m.displayName || m.userName;
              return (
                <div key={m.userId} className={styles.memberRow}>
                  <div className={styles.memberAvatarWrap}>
                    <Avatar fallback={name} size="md" />
                    {m.isOnline && <span className={styles.memberOnlineDot} />}
                  </div>
                  <div className={styles.memberInfo}>
                    <span className={styles.memberName}>{name}</span>
                    <span className={styles.memberRole}>{m.role}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
