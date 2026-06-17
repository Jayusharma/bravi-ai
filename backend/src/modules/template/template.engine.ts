// template.engine.ts — pure parsing/compiling for template bodies.
//
// Used by BOTH internal and WhatsApp templates:
//   - parseBody / classifyVariable / sourceForLabel → run for every template on save.
//   - compileBody ([Label] → {{1}} positional) → only meaningful for WhatsApp (Meta format),
//     but harmless to compute; we only persist it for WHATSAPP templates.
//
// No DB, no HTTP — deterministic functions, easy to unit-test later (deferred Step 2).

import { VariableType } from '@prisma/client';
import { getSystemField } from './template-system-fields';

/** Matches [Label] markers; inner text cannot contain brackets. */
const MARKER_RE = /\[([^[\]]+)\]/g;

export interface ParsedVariable {
    label: string;
    position: number; // 1-based, by first appearance; repeats reuse the same position
}

/** Extracts [Label] variables in order of first appearance, de-duplicated (no position gaps). */
export function parseBody(raw: string): ParsedVariable[] {
    const positionByLabel = new Map<string, number>();
    const out: ParsedVariable[] = [];
    let m: RegExpExecArray | null;
    MARKER_RE.lastIndex = 0;
    while ((m = MARKER_RE.exec(raw)) !== null) {
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

/** SYSTEM if the label is a known auto-fill field, otherwise CUSTOM. */
export function classifyVariable(label: string): VariableType {
    return getSystemField(label) ? VariableType.SYSTEM : VariableType.CUSTOM;
}

/** The persisted source key: the registry source for SYSTEM fields, else "manual". */
export function sourceForLabel(label: string): string {
    return getSystemField(label)?.source ?? 'manual';
}

/**
 * Compiles [Label] markers into Meta-style positional placeholders {{1}}, {{2}}, …
 * Sequential, no gaps, reuse-aware (same label → same number). WhatsApp templates only.
 */
export function compileBody(raw: string): string {
    const positionByLabel = new Map<string, number>();
    for (const v of parseBody(raw)) positionByLabel.set(v.label, v.position);
    return raw.replace(MARKER_RE, (full, inner: string) => {
        const label = inner.trim();
        if (!label) return full;
        const pos = positionByLabel.get(label);
        return pos ? `{{${pos}}}` : full;
    });
}
