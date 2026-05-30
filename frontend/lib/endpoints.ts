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
        UPLOAD_ATTACHMENT: (draftId: string) => `/outbound/drafts/${draftId}/attachments`,
        DELETE_ATTACHMENT: (draftId: string, attachmentId: string) => `/outbound/drafts/${draftId}/attachments/${attachmentId}`,
    },
} as const;
