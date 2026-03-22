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
} as const;
