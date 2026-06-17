// template-system-fields.ts — the fixed set of SYSTEM (auto-fillable) variables.
//
// Two jobs:
//   1. label → source mapping  (used by template.engine classify, at SAVE time)
//   2. source → live value     (used by findUsable, at USE time in a chat)
//
// A DB row stores the label "Customer Name" and its source "contact.displayName", but the CODE
// that reads contact.displayName from a live contact can only live here. Anything not listed is
// CUSTOM → the agent fills it manually. Keep in sync with frontend `lib/template-fields.ts`.

import { Contact, ContactChannel, Enquiry, User, MessageChannel } from '@prisma/client';

export interface VariableContext {
    contact?: (Contact & { channels: ContactChannel[] }) | null;
    enquiry?: Enquiry | null;
    user?: User | null;
    /** SystemConfig getter — undefined until a SystemConfig model exists (business name/phone). */
    config?: (key: string) => string | undefined;
}

export interface SystemFieldDef {
    label: string;
    source: string;
    resolve: (ctx: VariableContext) => string | undefined;
}

/** EnquiryIntent enum value (PRICING_REQUEST) → label ("Pricing Request"). */
function humanizeIntent(intent?: string | null): string | undefined {
    if (!intent) return undefined;
    return intent
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function channelIdentifier(ctx: VariableContext, channel: MessageChannel): string | undefined {
    return ctx.contact?.channels?.find((c) => c.channel === channel)?.identifier;
}

export const SYSTEM_FIELDS: SystemFieldDef[] = [
    { label: 'Customer Name', source: 'contact.displayName', resolve: (ctx) => ctx.contact?.displayName || undefined },
    { label: 'Customer Phone', source: 'contact.phone', resolve: (ctx) => channelIdentifier(ctx, MessageChannel.WHATSAPP) },
    { label: 'Customer Email', source: 'contact.email', resolve: (ctx) => channelIdentifier(ctx, MessageChannel.EMAIL) },
    { label: 'Product / Service', source: 'enquiry.intent', resolve: (ctx) => humanizeIntent(ctx.enquiry?.intent) },
    { label: 'Agent Name', source: 'user.displayName', resolve: (ctx) => ctx.user?.displayName || undefined },
    { label: 'Business Name', source: 'config.business_name', resolve: (ctx) => ctx.config?.('business_name') },
    { label: 'Business Phone', source: 'config.business_phone', resolve: (ctx) => ctx.config?.('business_phone') },
];

const BY_LABEL = new Map<string, SystemFieldDef>(SYSTEM_FIELDS.map((f) => [f.label.toLowerCase(), f]));
const BY_SOURCE = new Map<string, SystemFieldDef>(SYSTEM_FIELDS.map((f) => [f.source, f]));

export function getSystemField(label: string): SystemFieldDef | undefined {
    return BY_LABEL.get(label.trim().toLowerCase());
}

/** Resolves a stored variable `source` to a live value, or undefined if unresolvable. */
export function resolveBySource(source: string, ctx: VariableContext): string | undefined {
    return BY_SOURCE.get(source)?.resolve(ctx);
}
