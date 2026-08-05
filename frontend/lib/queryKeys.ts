import { Channel } from '@/contracts/socketEvents';

/**
 * ============================================================================
 * STEP 2: QUERY KEY REGISTRY
 * Spec Ref: Section 6
 * Single source of truth for all TanStack Query cache keys.
 * 
 * HARD INVARIANT:
 * - Channel is NEVER part of a query key for messages or conversations.
 * - Channel pages are UI filters over a unified cache.
 * - Inline key arrays anywhere else in the app are strictly forbidden.
 * ============================================================================
 */

export const qk = {
  /** Unified or channel-filtered conversations sidebar list */
  conversations: (channel?: Channel | 'ALL') =>
    channel && channel !== 'ALL'
      ? (['conversations', channel] as const)
      : (['conversations'] as const),

  /** Messages infinite query thread for a specific contact */
  messages: (contactId: string) => ['messages', contactId] as const,

  /** Contact profile metadata */
  contact: (contactId: string) => ['contact', contactId] as const,

  /** Channel-specific template library (Templates genuinely are a per-channel server resource) */
  templates: (channel: Channel) => ['templates', channel] as const,
} as const;

export type QueryKeyRegistry = typeof qk;
