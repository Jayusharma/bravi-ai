'use client';

import { useState } from 'react';
import { retryMessage } from '@/services/messaging/outbound.service';

interface Props {
    messageId: string;
    onRetried?: () => void;
}

export function RetryButton({ messageId, onRetried }: Props) {
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    async function handleRetry() {
        setLoading(true);
        try {
            await retryMessage(messageId);
            setDone(true);
            onRetried?.();
        } catch (err) {
            console.error('Retry failed:', err);
        } finally {
            setLoading(false);
        }
    }

    if (done) {
        return <span className="text-[10px] text-red-300/70">Retrying…</span>;
    }

    return (
        <button
            type="button"
            onClick={handleRetry}
            disabled={loading}
            className="text-[10px] text-red-300 underline underline-offset-2 hover:text-red-200 disabled:opacity-50 transition-colors"
        >
            {loading ? '…' : 'Retry'}
        </button>
    );
}
