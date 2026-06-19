import type { ReactNode } from 'react';

/**
 * Wraps every case-insensitive occurrence of `term` in `text` with a <mark>.
 * Returns the original string when there's no term. `markClass` lets the
 * caller control the highlight styling (yellow keyword).
 */
export function highlightKeyword(
  text: string,
  term: string | null | undefined,
  markClass: string,
): ReactNode {
  const t = term?.trim();
  if (!t) return text;

  const lower = text.toLowerCase();
  const lowerTerm = t.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < text.length) {
    const idx = lower.indexOf(lowerTerm, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className={markClass}>
        {text.slice(idx, idx + t.length)}
      </mark>,
    );
    i = idx + t.length;
  }

  return parts;
}
