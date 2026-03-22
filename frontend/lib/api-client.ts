import { getAuthToken } from './Auth';

const API_URL = (process.env.NEST_API_URL || '').trim();

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                    UNIFIED API CLIENT                             ║
 * ║  Single fetch function used by ALL services.                     ║
 * ║  ✅ Always runs server-side (token never touches browser)        ║
 * ║  ✅ Automatic retry on network failures                          ║
 * ║  ✅ Classified error handling (NETWORK / BACKEND / AUTH / UNKNOWN)║
 * ║  ✅ Structured console logging for every request                 ║
 * ║  ✅ Response envelope unwrapping                                  ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════
// ERROR TYPES — Classified so frontend knows exactly what happened
// ═══════════════════════════════════════════════════════════════════

export type ApiErrorType =
    | 'NETWORK_ERROR'     // Client couldn't reach the server at all (DNS, timeout, ECONNREFUSED)
    | 'AUTH_ERROR'        // 401 — token expired or invalid
    | 'FORBIDDEN_ERROR'   // 403 — permission denied (CASL)
    | 'VALIDATION_ERROR'  // 400 — bad request, DTO validation failed
    | 'NOT_FOUND_ERROR'   // 404 — resource doesn't exist
    | 'CONFLICT_ERROR'    // 409 — optimistic locking / duplicate
    | 'SERVER_ERROR'      // 500+ — backend crashed or threw unhandled error
    | 'UNKNOWN_ERROR';    // Catch-all

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public type: ApiErrorType,
        public details?: string[],   // Validation errors array
        public url?: string,         // Which URL failed
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Classify HTTP status into error type.
 */
function classifyError(status: number): ApiErrorType {
    if (status === 401) return 'AUTH_ERROR';
    if (status === 403) return 'FORBIDDEN_ERROR';
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 404) return 'NOT_FOUND_ERROR';
    if (status === 409) return 'CONFLICT_ERROR';
    if (status >= 500) return 'SERVER_ERROR';
    return 'UNKNOWN_ERROR';
}

/**
 * Human-readable error type label for logs and toasts.
 */
export function getErrorLabel(type: ApiErrorType): string {
    const labels: Record<ApiErrorType, string> = {
        NETWORK_ERROR: '🔌 Network Error',
        AUTH_ERROR: '🔒 Authentication Error',
        FORBIDDEN_ERROR: '🚫 Permission Denied',
        VALIDATION_ERROR: '⚠️ Validation Error',
        NOT_FOUND_ERROR: '🔍 Not Found',
        CONFLICT_ERROR: '⚡ Conflict',
        SERVER_ERROR: '💥 Server Error',
        UNKNOWN_ERROR: '❓ Unknown Error',
    };
    return labels[type];
}

// ═══════════════════════════════════════════════════════════════════
// LOGGER — Structured console logging for every API call
// ═══════════════════════════════════════════════════════════════════

function logRequest(method: string, url: string) {
    console.log(
        `\x1b[36m[API →]\x1b[0m ${method} ${url}`,
    );
}

function logSuccess(method: string, url: string, status: number, durationMs: number) {
    console.log(
        `\x1b[32m[API ✓]\x1b[0m ${method} ${url} → ${status} (${durationMs}ms)`,
    );
}

function logError(method: string, url: string, error: ApiError | Error, durationMs: number) {
    if (error instanceof ApiError) {
        console.error(
            `\x1b[31m[API ✗]\x1b[0m ${method} ${url} → ${error.status} [${error.type}] ${error.message} (${durationMs}ms)`,
        );
        if (error.details?.length) {
            console.error(`\x1b[31m[API ✗]\x1b[0m   Details: ${error.details.join(', ')}`);
        }
    } else {
        console.error(
            `\x1b[31m[API ✗]\x1b[0m ${method} ${url} → [NETWORK_ERROR] ${error.message} (${durationMs}ms)`,
        );
    }
}

function logRetry(method: string, url: string, attempt: number, maxRetries: number) {
    console.warn(
        `\x1b[33m[API ↻]\x1b[0m ${method} ${url} — Retry ${attempt}/${maxRetries}`,
    );
}

// ═══════════════════════════════════════════════════════════════════
// API CLIENT — The ONE fetch function
// ═══════════════════════════════════════════════════════════════════

interface ApiClientOptions extends Omit<RequestInit, 'body'> {
    body?: Record<string, unknown> | unknown[] | string;
    params?: Record<string, string | number | undefined>;
    retry?: number; // Number of retries (default: 2 for GET, 0 for mutations)
}

/**
 * The ONE fetch function for the entire app.
 * Called by services (Server Actions), which always run on the server.
 * 
 * Replaces the old ServerApi.ts — this is the single source of truth.
 */
export async function apiClient<T = unknown>(
    path: string,
    options: ApiClientOptions = {},
): Promise<T> {
    const { body, params, retry, ...fetchOptions } = options;
    const method = (fetchOptions.method || 'GET').toUpperCase();

    // Build URL with query params
    let url = `${API_URL}${path}`;
    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                searchParams.set(key, String(value));
            }
        });
        const qs = searchParams.toString();
        if (qs) url += `?${qs}`;
    }

    // Attach auth token from HttpOnly cookie
    const token = await getAuthToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(fetchOptions.headers || {}),
    };

    // Build fetch config
    const config: RequestInit = {
        ...fetchOptions,
        method,
        headers,
        cache: 'no-store',
        ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    };

    // Retry logic: retry GETs on network failure, never retry mutations by default
    const maxRetries = retry ?? (method === 'GET' ? 2 : 0);
    let lastError: Error | null = null;
    const startTime = Date.now();

    // Log outgoing request
    logRequest(method, url);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            logRetry(method, url, attempt, maxRetries);
        }

        try {
            const res = await fetch(url, config);
            const durationMs = Date.now() - startTime;

            // ── Handle error responses ──
            if (!res.ok) {
                const errorType = classifyError(res.status);
                let message = `Request failed with status ${res.status}`;
                let details: string[] | undefined;

                try {
                    const errorBody = await res.json();

                    // NestJS standard error format: { message: string | string[], error: string, statusCode: number }
                    if (errorBody?.message) {
                        if (Array.isArray(errorBody.message)) {
                            details = errorBody.message;
                            message = errorBody.message.join(', ');
                        } else {
                            message = errorBody.message;
                        }
                    }
                    // Our custom envelope: { success: false, error: { message } }
                    else if (errorBody?.error?.message) {
                        message = errorBody.error.message;
                    }
                } catch {
                    // Could not parse error body — use default message
                }

                const apiError = new ApiError(message, res.status, errorType, details, url);
                logError(method, url, apiError, durationMs);
                throw apiError;
            }

            // ── Success response ──
            logSuccess(method, url, res.status, durationMs);

            const json = await res.json();

            // Unwrap standardized { success, data } envelope
            if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
                return json.data as T;
            }

            return json as T;
        } catch (error) {
            const durationMs = Date.now() - startTime;

            // If it's already an ApiError (4xx/5xx), don't retry client errors
            if (error instanceof ApiError) {
                if (error.status >= 400 && error.status < 500) {
                    throw error; // Don't retry client errors
                }
                // Server errors (5xx) can be retried
                lastError = error;
            } else {
                // Network error — ECONNREFUSED, DNS failure, timeout, etc.
                const networkError = new ApiError(
                    `Cannot reach server: ${(error as Error).message}`,
                    0,
                    'NETWORK_ERROR',
                    undefined,
                    url,
                );
                logError(method, url, networkError, durationMs);
                lastError = networkError;
            }

            // Wait before retry (exponential backoff: 300ms, 900ms, 2700ms)
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt)));
                continue;
            }
        }
    }

    throw lastError || new ApiError('Request failed after retries', 0, 'UNKNOWN_ERROR', undefined, url);
}
