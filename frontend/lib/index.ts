/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                       LIB BARREL INDEX                           ║
 * ║  Import from '@/lib' instead of individual files.                ║
 * ║  e.g.  import { apiClient, API, APP_ROLES } from '@/lib';        ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

// API layer (server-safe — used in Server Actions / server components)
export { apiClient, ApiError, getErrorLabel } from './api-client';
export type { ApiErrorType } from './api-client';

// Endpoint map
export { API } from './endpoints';

// Error handling utilities
export {
    handleResult,
    handleVoidResult,
    ERROR_TYPE_MAP,
} from './error';
export type { ServiceResult } from './error';

// Role / permission constants
export { APP_ROLES, CRUD_ACTIONS } from './roles';
export type { AppRole, CrudAction } from './roles';

// Error messages (shared constants — safe everywhere)
export { ERROR_MESSAGES } from './error-messages';

// Navigation config (types + items — safe everywhere)
export { NAV_ITEMS, getNavBySection } from './navigation';
export type { NavItem } from './navigation';

// NOTE: The following must be imported DIRECTLY — they are environment-specific:
//   '@/lib/socket'   → 'use client'  — import directly in client components
//   '@/lib/upload'   → 'use client'  — import directly in client components
//   '@/lib/Auth'     → server-only   — import directly in server components / services.
// NOTE: '@/lib/navigation' exports JSX — import it directly if needed.
