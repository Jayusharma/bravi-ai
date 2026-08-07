// cursor.ts — Opaque base64url cursor encoding for composite (createdAt, id) pagination.

export interface CursorPayload {
  createdAt: string; // ISO 8601
  id: string;
}

/** Encodes a cursor payload to an opaque base64url string. */
export function encodeCursor(c: CursorPayload): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/** Decodes an opaque cursor string — returns null if invalid or missing. */
export function decodeCursor(s: string | undefined): CursorPayload | null {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
      typeof (parsed as Record<string, unknown>).id !== 'string'
    ) {
      return null;
    }
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

/**
 * Builds a Prisma WHERE fragment for stable composite-cursor pagination.
 * Fetches rows where (createdAt, id) comes BEFORE the cursor (descending order).
 * Use with: orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1
 */
export function buildCursorWhere(cursor: CursorPayload) {
  return {
    OR: [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ],
  };
}

/** Slices the result set and computes nextCursor after a limit+1 fetch. */
export function paginateResult<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; cursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const cursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null;
  return { data, cursor, hasMore };
}

// ── Seq cursor — for ConversationMessage pagination scoped to one contactId.
//    `seq` is already a unique, monotonic, per-contact integer (see Contact.lastMessageSeq),
//    so unlike the composite (createdAt, id) cursor above, a bare seq is a sufficient cursor
//    on its own — no tiebreaker needed.

/** Encodes a bare seq cursor to an opaque base64url string. */
export function encodeSeqCursor(seq: number): string {
  return Buffer.from(String(seq), 'utf8').toString('base64url');
}

/** Decodes an opaque seq cursor string — returns null if invalid or missing. */
export function decodeSeqCursor(s: string | undefined): number | null {
  if (!s) return null;
  try {
    const n = Number(Buffer.from(s, 'base64url').toString('utf8'));
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/** Slices a seq-ordered (desc) result set and computes the next opaque seq cursor. */
export function paginateSeqResult<T extends { seq: number }>(
  rows: T[],
  limit: number,
): { data: T[]; cursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const cursor = hasMore && last ? encodeSeqCursor(last.seq) : null;
  return { data, cursor, hasMore };
}
