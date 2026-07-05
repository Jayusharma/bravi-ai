'use client';

// ChannelFilesTab — the "Files" tab of a channel: every attachment ever sent,
// newest first. A filtered query over messages — no separate storage.

import { useCallback, useEffect, useState } from 'react';
import { getChannelFiles, type ChatFileItem } from '@/services/chat/chat.service';

interface ChannelFilesTabProps {
    conversationId: string;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChannelFilesTab({ conversationId }: ChannelFilesTabProps) {
    const [files, setFiles] = useState<ChatFileItem[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (nextCursor?: string) => {
        try {
            const res = await getChannelFiles(conversationId, nextCursor ? { cursor: nextCursor } : undefined);
            setFiles((prev) => (nextCursor ? [...prev, ...res.files] : res.files));
            setCursor(res.nextCursor);
            setHasMore(res.hasMore);
        } catch {
            /* not a member anymore */
        } finally {
            setLoading(false);
        }
    }, [conversationId]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="flex-1 p-6 text-center text-sm text-muted-foreground">Loading files…</div>;
    if (files.length === 0) {
        return <div className="flex-1 p-10 text-center text-sm text-muted-foreground">No files shared in this channel yet.</div>;
    }

    const images = files.filter((f) => f.kind === 'IMAGE' && f.cdnUrl);
    const others = files.filter((f) => f.kind !== 'IMAGE' || !f.cdnUrl);

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {/* Image grid */}
            {images.length > 0 && (
                <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {images.map((f) => (
                        <a key={f.id} href={f.cdnUrl!} target="_blank" rel="noreferrer" className="group relative block aspect-square overflow-hidden rounded-xl border border-border/40 bg-accent/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f.cdnUrl!} alt={f.fileName} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                        </a>
                    ))}
                </div>
            )}

            {/* Documents / media list */}
            <div className="space-y-1.5">
                {others.map((f) => (
                    <a
                        key={f.id}
                        href={f.cdnUrl ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/60 px-3 py-2.5 transition-colors hover:bg-accent/50"
                    >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                            <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{f.fileName}</span>
                            <span className="text-xs text-muted-foreground">
                                {formatSize(f.fileSize)} · {f.message.sender.displayName || f.message.sender.userName}
                            </span>
                        </span>
                        <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
                        </svg>
                    </a>
                ))}
            </div>

            {hasMore && cursor && (
                <button
                    onClick={() => load(cursor)}
                    className="mt-3 w-full rounded-xl border border-border/40 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 cursor-pointer"
                >
                    Load more
                </button>
            )}
        </div>
    );
}
