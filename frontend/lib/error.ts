/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                   CENTRALIZED ERROR HANDLER                       ║
 * ║  Single file for ALL error handling across the app.               ║
 * ║                                                                   ║
 * ║  Architecture:                                                    ║
 * ║    api-client.ts  → fetch, retry, throw ApiError                 ║
 * ║    error.ts       → catch, classify, log, toast  (THIS FILE)     ║
 * ║    Toast.tsx      → pure UI rendering                            ║
 * ║                                                                   ║
 * ║  Usage in components:                                             ║
 * ║    const toast = useToast();                                      ║
 * ║    const data = handleResult(result, toast, { ... });            ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

import type { ApiErrorType } from '@/lib/api-client';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

/** Standardized response envelope returned by ALL service functions */
export interface ServiceResult<T> {
    success: boolean;
    data: T | null;
    error: string | null;
}

/** Minimal toast API — matches what useToast() returns */
interface ToastAPI {
    success: (title: string, description?: string) => void;
    error: (title: string, description?: string) => void;
    warning: (title: string, description?: string) => void;
    info: (title: string, description?: string) => void;
}

/** Options for handleResult / handleVoidResult */
interface HandleOptions {
    /** Message shown on success toast. If omitted, no success toast (silent success). */
    successMessage?: string;
    /** Title for error toast. Defaults to "Operation Failed". */
    errorTitle?: string;
    /** Fallback error message if result.error is null/empty. */
    errorMessage?: string;
    /** If true, suppress error toast (only console.error). Default: false. */
    silent?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// ERROR CLASSIFICATION — Maps ApiError types to user-friendly labels
// ═══════════════════════════════════════════════════════════════════

const ERROR_TYPE_MAP: Record<ApiErrorType, { title: string; level: 'error' | 'warning' | 'info' }> = {
    NETWORK_ERROR: { title: 'Connection Failed', level: 'error' },
    AUTH_ERROR: { title: 'Session Expired', level: 'warning' },
    FORBIDDEN_ERROR: { title: 'Access Denied', level: 'error' },
    VALIDATION_ERROR: { title: 'Validation Error', level: 'warning' },
    NOT_FOUND_ERROR: { title: 'Not Found', level: 'info' },
    CONFLICT_ERROR: { title: 'Conflict Detected', level: 'warning' },
    SERVER_ERROR: { title: 'Server Error', level: 'error' },
    UNKNOWN_ERROR: { title: 'Something Went Wrong', level: 'error' },
};

export { ERROR_TYPE_MAP };

// ═══════════════════════════════════════════════════════════════════
// CONSOLE LOGGER — Structured dev-friendly logging
// ═══════════════════════════════════════════════════════════════════

function logSuccess(context: string, data?: unknown) {
    if (process.env.NODE_ENV === 'production') return;
    console.info(
        `%c[✓ ${context}]`,
        'color: #16a34a; font-weight: bold',
        data ?? '',
    );
}

function logError(context: string, error: string) {
    console.error(
        `%c[✗ ${context}]`,
        'color: #dc2626; font-weight: bold',
        error,
    );
}

// ═══════════════════════════════════════════════════════════════════
// HANDLERS — Use these in components after service calls
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle a ServiceResult<T> from any service call.
 *
 * - On success: optionally shows a success toast, logs to console, returns data.
 * - On failure: shows error toast, logs to console, returns null.
 *
 * @example
 *   const result = await createSubjectBundle('billing');
 *   const data = handleResult(result, toast, {
 *       successMessage: 'Subject created!',
 *       errorTitle: 'Create Failed',
 *   });
 *   if (!data) return; // error already toasted + logged
 */
export function handleResult<T>(
    result: ServiceResult<T>,
    toast: ToastAPI,
    options: HandleOptions = {},
): T | null {
    const {
        successMessage,
        errorTitle = 'Operation Failed',
        errorMessage = 'An unexpected error occurred.',
        silent = false,
    } = options;

    if (result.success && result.data !== null) {
        logSuccess(successMessage ?? 'Operation completed', result.data);
        if (successMessage) {
            toast.success(successMessage);
        }
        return result.data;
    }

    // ── Failure ──
    const displayError = result.error ?? errorMessage;
    logError(errorTitle, displayError);

    if (!silent) {
        toast.error(errorTitle, displayError);
    }

    return null;
}

/**
 * Handle a ServiceResult<void> (for mutations that return nothing).
 * Returns true on success, false on failure.
 *
 * @example
 *   const result = await saveRolePermissions(role, entries);
 *   if (!handleVoidResult(result, toast, { successMessage: 'Saved!' })) return;
 */
export function handleVoidResult(
    result: ServiceResult<void>,
    toast: ToastAPI,
    options: HandleOptions = {},
): boolean {
    const {
        successMessage,
        errorTitle = 'Operation Failed',
        errorMessage = 'An unexpected error occurred.',
        silent = false,
    } = options;

    if (result.success) {
        logSuccess(successMessage ?? 'Operation completed');
        if (successMessage) {
            toast.success(successMessage);
        }
        return true;
    }

    const displayError = result.error ?? errorMessage;
    logError(errorTitle, displayError);

    if (!silent) {
        toast.error(errorTitle, displayError);
    }

    return false;
}
