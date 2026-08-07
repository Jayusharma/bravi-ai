/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                     CENTRALIZED API ENDPOINTS                     ║
 * ║  Change any URL once here → updates everywhere in the app.       ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

export const API = {
    // ── Auth ──
    AUTH: {
        LOGIN: '/auth/login',
        ME: '/auth/me',
    },

    // ── Enquiry ──
    ENQUIRY: {
        LIST: '/enquiry',
        STATS: '/enquiry/stats',
        DETAIL: (id: string) => `/enquiry/${id}`,
        CREATE: '/enquiry',
        STATUS: (id: string) => `/enquiry/${id}/status`,
        ASSIGN: (id: string) => `/enquiry/${id}/assign`,
        TAGS: (id: string) => `/enquiry/${id}/tags`,
        MESSAGES: (id: string) => `/enquiry/${id}/messages`,
        NOTES: (id: string) => `/enquiry/${id}/notes`,
        BULK_DELETE: '/enquiry/bulk-delete',
    },

    // ── Contact ──
    CONTACT: {
        LIST: '/contact',
        STATS: '/contact/stats',
        CREATE: '/contact',
        DETAIL: (id: string) => `/contact/${id}`,
        UPDATE: (id: string) => `/contact/${id}`,
        DELETE: (id: string) => `/contact/${id}`,
        DELETE_BULK: '/contact',
        ADD_CHANNEL: (id: string) => `/contact/${id}/channels`,
        REMOVE_CHANNEL: (id: string, channelId: string) => `/contact/${id}/channels/${channelId}`,
        SET_PRIMARY: (id: string, channelId: string) => `/contact/${id}/channels/${channelId}/primary`,
        ENQUIRIES: (id: string) => `/contact/${id}/enquiries`,
    },

    // ── Users ──
    USER: {
        LIST: '/users',
        DETAIL: (id: string) => `/users/${id}`,
    },

    PERMISSION: {
        LIST: '/permissions',
        DETAIL: (id: string) => `/permissions/${id}`,
        CREATE: '/permissions/create',
        UPDATE: (id: string) => `/permissions/${id}`,
        DELETE: (id: string) => `/permissions/${id}`,
        SUBJECTS: '/permissions/subjects',
        ROLE_ASSIGNMENTS: '/permissions/roles/all',
        ROLE_BULK_ASSIGN: '/permissions/roles/bulk-assign',
        ROLE_CLEAR: (role: string) => `/permissions/roles/${role}/clear`,
    },


    CONVERSATION: {
        LIST: '/conversations',
        THREAD: (enquiryId: string) => `/conversations/${enquiryId}/thread`,
        STAR: (messageId: string) => `/conversations/messages/${messageId}/star`,
        STARRED: (contactId: string) => `/conversations/${contactId}/starred`,
        UNREAD_SUMMARY: '/conversations/unread-summary',
    },

    // ── Internal Team Chat ──
    CHAT: {
        ROOM: '/chat/room', // resolves the #general channel (org-wide default landing)
        UNREAD: '/chat/unread',
        // Channels & DMs (Discord-style)
        CONVERSATIONS: '/chat/conversations', // sidebar: my channels + DMs with unread counts
        CHANNELS: '/chat/channels', // POST create
        CHANNEL: (id: string) => `/chat/channels/${id}`, // PATCH edit/archive
        CHANNEL_MEMBERS: (id: string) => `/chat/channels/${id}/members`, // POST add people
        CHANNEL_MEMBER: (id: string, userId: string) => `/chat/channels/${id}/members/${userId}`, // DELETE kick/leave
        DM: '/chat/dm', // POST open (or find) the DM with a user — idempotent
        META: (roomId: string) => `/chat/room/${roomId}/meta`, // bootstrap metadata to open any channel/DM
        FILES: (roomId: string) => `/chat/room/${roomId}/files`, // Files tab
        UPLOAD: (roomId: string) => `/chat/room/${roomId}/attachments`, // multipart upload → descriptor
        REACTIONS: (roomId: string, messageId: string) => `/chat/room/${roomId}/messages/${messageId}/reactions`,
        // Messages
        MESSAGES: (roomId: string) => `/chat/room/${roomId}/messages`,
        NEWER: (roomId: string) => `/chat/room/${roomId}/messages/newer`,
        SEARCH: (roomId: string) => `/chat/room/${roomId}/messages/search`,
        AROUND: (roomId: string) => `/chat/room/${roomId}/messages/around`,
        MEMBERS: (roomId: string) => `/chat/room/${roomId}/members`,
        PINNED: (roomId: string) => `/chat/room/${roomId}/pinned`, // thread banner
        STARRED_LIST: (roomId: string) => `/chat/room/${roomId}/starred`, // the Starred tab
        PIN: (roomId: string, messageId: string) => `/chat/room/${roomId}/messages/${messageId}/pin`,
        STAR: (roomId: string, messageId: string) => `/chat/room/${roomId}/messages/${messageId}/star`,
        EDIT: (roomId: string, messageId: string) => `/chat/room/${roomId}/messages/${messageId}`,
        DELETE: (roomId: string, messageId: string) => `/chat/room/${roomId}/messages/${messageId}`,
    },

    // ── Search ──
    SEARCH: {
        QUERY: '/search',
    },

    // ── Outbound ──
    OUTBOUND: {
        CREATE_DRAFT: (enquiryId: string) => `/outbound/enquiries/${enquiryId}/drafts`,
        GET_DRAFT: (enquiryId: string) => `/outbound/enquiries/${enquiryId}/draft`,
        UPDATE_DRAFT: (draftId: string) => `/outbound/drafts/${draftId}`,
        DELETE_DRAFT: (draftId: string) => `/outbound/drafts/${draftId}`,
        SEND_DRAFT: (draftId: string) => `/outbound/drafts/${draftId}/send`,
        MESSAGES: (enquiryId: string) => `/outbound/enquiries/${enquiryId}/messages`,
        RETRY: (messageId: string) => `/outbound/messages/${messageId}/retry`,
        FORWARD: (messageId: string) => `/outbound/messages/${messageId}/forward`,
        UPLOAD_ATTACHMENT: (draftId: string) => `/outbound/drafts/${draftId}/attachments`,
        DELETE_ATTACHMENT: (draftId: string, attachmentId: string) => `/outbound/drafts/${draftId}/attachments/${attachmentId}`,
    },

    // ── Templates ──
    TEMPLATE: {
        LIST: '/templates',
        DETAIL: (id: string) => `/templates/${id}`,
        CREATE: '/templates',
        UPDATE: (id: string) => `/templates/${id}`,
        DELETE: (id: string) => `/templates/${id}`,
        DUPLICATE: (id: string) => `/templates/${id}/duplicate`,
        VARIABLES_SUGGEST: '/templates/variables/suggest',
        USABLE: '/templates/usable', // templates usable in a conversation, variables pre-resolved
        SUBMIT: (id: string) => `/templates/${id}/submit`, // Step 5 — WhatsApp approval
    },

    // ── Channels (Administration → Channels) ──
    CHANNEL: {
        LIST: '/channels',
        CREATE: '/channels',
        UPDATE: (id: string) => `/channels/${id}`,
        STATUS: (id: string) => `/channels/${id}/status`, // the on/off toggle
        DELETE: (id: string) => `/channels/${id}`,
    },
} as const;
