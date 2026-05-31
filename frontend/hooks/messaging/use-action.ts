'use client';

import { useTransition, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Generic hook for calling Server Actions from client components.
 * 
 * What it does:
 *  - Wraps any Server Action with loading + error state
 *  - Auto-refreshes server components after success
 *  - Classifies errors for smart UI display
 * 
 * When to use:
 *  - Button clicks that trigger mutations (changeStatus, assign, etc.)
 *  - NOT for forms — use useActionState for forms (like the login page)
 * 
 * Usage:
 *   const { execute, pending, error } = useAction(changeStatus);
 *   <button onClick={() => execute(id, 'OPEN', version)} disabled={pending}>
 */
export function useAction<TArgs extends unknown[], TResult>(
    action: (...args: TArgs) => Promise<TResult>,
    options?: {
        onSuccess?: (result: TResult) => void;
        onError?: (error: string) => void;
        refreshOnSuccess?: boolean;
    },
) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const router = useRouter();

    const execute = useCallback(
        (...args: TArgs) => {
            setError(null);
            setSuccess(false);

            startTransition(async () => {
                try {
                    const result = await action(...args);
                    setSuccess(true);
                    options?.onSuccess?.(result);

                    if (options?.refreshOnSuccess !== false) {
                        router.refresh();
                    }
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : 'Something went wrong';
                    setError(message);
                    options?.onError?.(message);
                    console.error(`[useAction] ${message}`);
                }
            });
        },
        [action, options, router, startTransition],
    );

    return {
        execute,
        pending: isPending,
        error,
        success,
        reset: () => { setError(null); setSuccess(false); },
    };
}
