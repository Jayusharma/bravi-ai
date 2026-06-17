// template-parse.ts — FRONTEND-only helpers for live preview + variable chips.
//
// The BACKEND is the authoritative parser/compiler (it writes TemplateVariable rows and the
// {{1}} bodyCompiled on save). These helpers exist purely so the editor can show detected
// variables and a live preview as the user types, before anything is saved. No business rules
// live here — just "which [Labels] are in this text, and where".

import { SYSTEM_FIELDS } from './template-fields';

/** Matches [Label] markers; inner text cannot contain brackets. */
const MARKER_RE = /\[([^[\]]+)\]/g;

export interface ParsedVariable {
    label: string;
    position: number; // 1-based, by first appearance; repeats reuse the same position
}

const SYSTEM_LABELS = new Set(SYSTEM_FIELDS.map((f) => f.label.toLowerCase()));

export function isSystemLabel(label: string): boolean {
    return SYSTEM_LABELS.has(label.trim().toLowerCase());
}

/** Extracts [Label] variables in order of first appearance, de-duplicated. */
export function parseTemplateVariables(body: string): ParsedVariable[] {
    const positionByLabel = new Map<string, number>();
    const out: ParsedVariable[] = [];
    let m: RegExpExecArray | null;
    MARKER_RE.lastIndex = 0;
    while ((m = MARKER_RE.exec(body)) !== null) {
        const label = m[1].trim();
        if (!label) continue;
        if (!positionByLabel.has(label)) {
            const position = positionByLabel.size + 1;
            positionByLabel.set(label, position);
            out.push({ label, position });
        }
    }
    return out;
}

export type PreviewToken =
    | { type: 'text'; value: string }
    | { type: 'var'; label: string; value: string | null };

/**
 * Tokenizes a body into text + variable segments for highlighted preview rendering.
 * `values` maps label → filled value; missing/empty → null (rendered as a placeholder chip).
 */
export function tokenizeBody(
    body: string,
    values: Record<string, string> = {},
): PreviewToken[] {
    const tokens: PreviewToken[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    MARKER_RE.lastIndex = 0;
    while ((m = MARKER_RE.exec(body)) !== null) {
        if (m.index > lastIndex) {
            tokens.push({ type: 'text', value: body.slice(lastIndex, m.index) });
        }
        const label = m[1].trim();
        const filled = values[label]?.trim();
        tokens.push({ type: 'var', label, value: filled ? filled : null });
        lastIndex = m.index + m[0].length;
    }
    if (lastIndex < body.length) {
        tokens.push({ type: 'text', value: body.slice(lastIndex) });
    }
    return tokens;
}

/**
 * Substitutes [Label] markers with filled values for the final inserted text.
 * Unfilled variables keep their [Label] marker so the agent notices the gap.
 */
export function renderBody(body: string, values: Record<string, string>): string {
    return body.replace(MARKER_RE, (full, inner: string) => {
        const v = values[inner.trim()]?.trim();
        return v ? v : full;
    });
}

/** Auto-slugifies a friendly name into a Meta-safe template name (lowercase + underscores). */
export function slugifyName(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
}
