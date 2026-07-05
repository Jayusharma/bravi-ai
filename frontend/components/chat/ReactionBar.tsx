'use client';

// ReactionBar — the emoji reaction chips under a message bubble.
// Groups the raw reaction rows (userId+emoji) into chips with counts; clicking a
// chip toggles YOUR reaction of that emoji. Parent owns the API call.

import type { ChatReaction } from '@/services/chat/chat.service';

/** The quick-pick set shown in the message menu (Discord-style small fixed set). */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '✅', '👀'];

interface ReactionBarProps {
    reactions: ChatReaction[];
    currentUserId: string | null;
    onToggle: (emoji: string) => void;
}

export function ReactionBar({ reactions, currentUserId, onToggle }: ReactionBarProps) {
    if (!reactions || reactions.length === 0) return null;

    // Group raw rows → one chip per emoji with count + did-I-react
    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of reactions) {
        const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
        g.count += 1;
        if (r.userId === currentUserId) g.mine = true;
        grouped.set(r.emoji, g);
    }

    return (
        <div className="mt-1 flex flex-wrap gap-1">
            {[...grouped.entries()].map(([emoji, g]) => (
                <button
                    key={emoji}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors cursor-pointer ${
                        g.mine
                            ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                            : 'border-border/50 bg-background/60 text-foreground/80 hover:bg-accent'
                    }`}
                    title={g.mine ? 'Remove your reaction' : 'React'}
                >
                    <span>{emoji}</span>
                    <span className="font-semibold">{g.count}</span>
                </button>
            ))}
        </div>
    );
}
