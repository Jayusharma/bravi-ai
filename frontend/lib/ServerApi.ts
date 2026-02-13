import { getAuthToken } from "./Auth";

const Api_Url = (process.env.NEST_API_URL || '').trim();

/**
 * Server-side fetch utility.
 * 
 * Automatically:
 * - Attaches JWT from HttpOnly cookie
 * - Unwraps the standardized response format { success, data }
 * - Throws structured errors
 */
export async function serverFetch(
    path: string,
    options: RequestInit = {},
) {
    const token = await getAuthToken();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    }

    const res = await fetch(`${Api_Url}${path}`, {
        ...options,
        headers,
        cache: 'no-store'
    })

    if (res.status === 401) {
        throw new Error('UNAUTHORIZED');
    }

    if (!res.ok) {
        // Try to parse the standardized error response
        try {
            const errorBody = await res.json();
            if (errorBody?.error?.message) {
                throw new Error(errorBody.error.message);
            }
        } catch (e) {
            if (e instanceof Error && e.message !== 'UNAUTHORIZED') {
                throw e;
            }
        }
        throw new Error(`Request failed with status ${res.status}`);
    }

    const json = await res.json();

    // Unwrap the standardized { success, data } envelope
    if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
        return json.data;
    }

    // Fallback for non-wrapped responses
    return json;
}