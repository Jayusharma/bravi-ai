'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

interface DlqEntry {
  id: string;
  conversationMessageId: string;
  jobName: string;
  lastError: string;
  attemptCount: number;
  createdAt: string;
  resolvedAt: string | null;
}

interface DlqResponse {
  items: DlqEntry[];
  total: number;
  page: number;
  limit: number;
}

export default function DlqAdminPage() {
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchDlq = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<DlqResponse>('/outbound/dlq');
      setEntries(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load failed messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDlq(); }, [fetchDlq]);

  const retry = async (id: string) => {
    setActionLoading(id);
    try {
      await apiClient(`/outbound/dlq/${id}/retry`, { method: 'POST' });
      await fetchDlq();
    } catch (err: any) {
      setError(err.message ?? 'Retry failed');
    } finally {
      setActionLoading(null);
    }
  };

  const discard = async (id: string) => {
    if (!confirm('Permanently discard this failed message?')) return;
    setActionLoading(id);
    try {
      await apiClient(`/outbound/dlq/${id}`, { method: 'DELETE' });
      await fetchDlq();
    } catch (err: any) {
      setError(err.message ?? 'Discard failed');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Failed Messages (Dead Letter Queue)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Messages that failed after all retry attempts. Retry or discard each one.
          </p>
        </div>
        <button
          onClick={fetchDlq}
          className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-sm border border-red-200 dark:border-red-800">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center">
          ✅ No failed messages. All clear.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">{total} unresolved</p>
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border p-4 bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                        {entry.jobName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.attemptCount} attempt{entry.attemptCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString('en-IN')}
                      </span>
                    </div>
                    <p className="text-sm text-red-600 dark:text-red-400 truncate" title={entry.lastError}>
                      {entry.lastError}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                      msg: {entry.conversationMessageId}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => retry(entry.id)}
                      disabled={actionLoading === entry.id}
                      className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                    >
                      {actionLoading === entry.id ? '…' : 'Retry'}
                    </button>
                    <button
                      onClick={() => discard(entry.id)}
                      disabled={actionLoading === entry.id}
                      className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
