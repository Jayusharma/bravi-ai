// socket-events.ts — All WebSocket event names and room builders. Import from here — never hardcode event strings.

export const SOCKET_EVENTS = {
  // Client → Server
  CONTACT_JOIN:   'contact:join',
  CONTACT_LEAVE:  'contact:leave',
  OUTBOUND_SEND:  'outbound:send',
  TYPING_START:   'typing:start',
  TYPING_STOP:    'typing:stop',

  // Server → Client: messages
  MESSAGE_NEW:    'chat:new-message',

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
  CHAT_JOIN:        'chat:join',
  CHAT_LEAVE:       'chat:leave',
  CHAT_DELIVERED:   'chat:delivered',
  CHAT_READ:        'chat:read',
  CHAT_MESSAGE_NEW:  'chat:message:new',
  CHAT_RECEIPTS:     'chat:receipts',
  CHAT_NOTIFICATION: 'chat:notification',
  CHAT_MESSAGE_PINNED:  'chat:message:pinned',
  CHAT_MESSAGE_STARRED: 'chat:message:starred',
  CHAT_MESSAGE_EDITED:  'chat:message:edited',
  CHAT_MESSAGE_DELETED: 'chat:message:deleted',
  CHAT_MESSAGE_REACTED: 'chat:message:reacted',           // reaction toggled — update chips live
  CHAT_CONVERSATION_UPDATED: 'chat:conversation:updated', // sidebar refresh (rename/members/archive/new)
  CHAT_MEMBERSHIP_REMOVED:   'chat:membership:removed',   // you were kicked — leave + route to #general
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Builds the room name for a contact — all real-time events scope to this room. */
export const ROOMS = {
  contact: (contactId: string) => `contact:${contactId}`,
  chat: (conversationId: string) => `chat:${conversationId}`,
} as const;
