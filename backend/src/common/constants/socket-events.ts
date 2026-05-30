// socket-events.ts — All WebSocket event names and room builders. Import from here — never hardcode event strings.

export const SOCKET_EVENTS = {
  // Client → Server
  CONTACT_JOIN:   'contact:join',
  CONTACT_LEAVE:  'contact:leave',
  OUTBOUND_SEND:  'outbound:send',
  DRAFT_TYPING:   'draft:typing',

  // Server → Client: messages
  MESSAGE_NEW:    'message:new',

  // Server → Client: outbound delivery
  OUTBOUND_SENT:   'outbound:sent',
  OUTBOUND_STATUS: 'outbound:status',
  OUTBOUND_FAILED: 'outbound:failed',

  // Server → Client: typing
  DRAFT_COMPOSING: 'draft:composing',
  DRAFT_STOPPED:   'draft:stopped',

  // Server → Client: contact list
  CONTACT_UPDATED:          'contact:updated',
  NOTIFICATION_NEW_MESSAGE: 'notification:new-message',

  // Server → Client: message mutations
  MESSAGE_REACTION_UPDATED: 'message:reaction_updated',
  MESSAGE_DELETED:          'message:deleted',
  MESSAGE_EDITED:           'message:edited',

  // Server → Client: presence
  PRESENCE_ONLINE:  'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Builds the room name for a contact — all real-time events scope to this room. */
export const ROOMS = {
  contact: (contactId: string) => `contact:${contactId}`,
} as const;
