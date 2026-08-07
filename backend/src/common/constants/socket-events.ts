// socket-events.ts — All WebSocket event names and room builders. Import from here — never hardcode event strings.

export const SOCKET_EVENTS = {
  // Client → Server
  CONTACT_JOIN:   'contact:join',
  CONTACT_LEAVE:  'contact:leave',
  OUTBOUND_SEND:  'outbound:send',
  TYPING_START:   'typing:start',
  TYPING_STOP:    'typing:stop',
  READ_MARK:      'read:mark', // agent viewed a contact's thread — advance Contact.lastReadSeq

  // Server → Client: messages
  MESSAGE_NEW:    'chat:new-message',

  // Server → Client: read state — GLOBAL broadcasts. lastReadSeq is a TEAM watermark, one
  // per contact, shared by every agent — never scope these to ROOMS.user, that would leave
  // other agents' caches stale.
  READ_UPDATED:   'read:updated',   // a contact's lastReadSeq changed
  UNREAD_SUMMARY: 'unread:summary', // { WHATSAPP, EMAIL } distinct-unread-contact counts changed

  // Server → Client: outbound delivery
  OUTBOUND_SENT:             'outbound:sent',
  OUTBOUND_FAILED:           'outbound:failed',
  OUTBOUND_RETRY_QUEUED:     'outbound:retry_queued',
  OUTBOUND_DELIVERY_UPDATED: 'outbound:delivery_updated',

  // Server → Client: typing
  TYPING_UPDATE: 'typing:update',
  CONVERSATION_TYPING: 'conversation:typing',

  // Server → Client: contact list
  CONTACT_UPDATED:          'contact:updated',
  NOTIFICATION_NEW_MESSAGE: 'notification:new-message',
  // Delta events — patch a single sidebar card instead of broadcasting the full list
  CONVERSATION_UPDATED:     'conversation:updated',
  CONVERSATION_NEW:         'conversation:new',

  // Server → Client: message mutations
  MESSAGE_REACTION_UPDATED: 'message:reaction_updated',
  MESSAGE_DELETED:          'message:deleted',
  MESSAGE_EDITED:           'message:edited',
  MESSAGE_STAR_TOGGLED:     'message:star_toggled',

  // Server → Client: presence
  PRESENCE_ONLINE:  'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',

  // ── Internal team chat (staff-to-staff) ──
  // Client → Server
  CHAT_JOIN:      'chat:join',
  CHAT_LEAVE:     'chat:leave',
  CHAT_DELIVERED: 'chat:delivered', // recipient's device received messages
  CHAT_READ:      'chat:read',      // recipient is viewing the room
  // Server → Client
  CHAT_MESSAGE_NEW:     'chat:message:new',
  CHAT_RECEIPTS:        'chat:receipts',     // { deliveredUpTo, readUpTo } for the room
  CHAT_NOTIFICATION:    'chat:notification', // to MEMBERS' user rooms only — drives per-channel unread badges
  CHAT_MESSAGE_PINNED:  'chat:message:pinned',
  CHAT_MESSAGE_STARRED: 'chat:message:starred',
  CHAT_MESSAGE_EDITED:  'chat:message:edited',
  CHAT_MESSAGE_DELETED: 'chat:message:deleted',
  CHAT_MESSAGE_REACTED: 'chat:message:reacted',          // reaction toggled — update chips live
  CHAT_CONVERSATION_UPDATED: 'chat:conversation:updated', // to member user rooms — sidebar refresh (rename/members/archive/new)
  CHAT_MEMBERSHIP_REMOVED:   'chat:membership:removed',   // to the kicked user's user room — leave + route away
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Builds the room name for a contact — all real-time events scope to this room. */
export const ROOMS = {
  contact: (contactId: string) => `contact:${contactId}`,
  /** Internal chat conversation room (channels + DMs). */
  chat: (conversationId: string) => `chat:${conversationId}`,
  /**
   * Per-user personal room — every socket of a user joins this on connect.
   * Lets the server target one user across all their tabs (membership-scoped
   * notifications, live kick) without keeping a userId→socket map.
   */
  user: (userId: string) => `user:${userId}`,
} as const;
