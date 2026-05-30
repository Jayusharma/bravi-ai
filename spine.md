# Enquiry Hub — Architectural Spine

**What this is:** the one document you code V1 against. It does three jobs:
1. Locks the **data model** so schema stops churning (these are your migrations).
2. Maps **what depends on what**, so you stop breaking module B when you touch module A.
3. Marks the **V2/V3 seams** — the columns and relations to leave room for *now* so you never rework the hot tables later.

**What this is NOT:** the V1/V2/V3 feature spec, voice-AI flows, or sales packaging. Those are deferred on purpose — they don't inform a single V1 schema decision. We write them when they're the thing you're building.

**How to use it:** keep it open while building. Update the "Build Tracker" at the bottom as you ship. When you return after a break, that tracker answers "what's done / what's next" without re-deriving it.

> Reconcile the V1 models below against your actual `schema.prisma`. I've built these from your documented model list — where a field collides or already exists, yours wins. The three places this matters most are flagged with ⚠️.

---

## 1. The Dependency Map — why things break

The reason a change ripples is that your modules depend on each other in a **direction**, and right now that direction isn't enforced. Lock this and changes stop leaking:

```
LAYER 0 — IDENTITY (changes here ripple everywhere; touch last, change rarely)
  User · Contact · ContactChannel · LeadSource
        │
LAYER 1 — INTAKE (depends on identity only)
  InboundMessage · QualificationRule · QualificationResult
        │
LAYER 2 — WORK UNIT (depends on identity + intake)
  Enquiry · EnquiryTimeline · ConversationMessage · InternalNote
        │
LAYER 3 — ACTION (depends on work unit; never depended ON by lower layers)
  OutboundDraft · ScheduledMessage · Template · AutomationRule
        │
LAYER 4 — DERIVED (read-only consumers; nothing depends on these)
  Notification · AnalyticsDailySnapshot · AiUsageLog
```

**The rule that stops the breakage:** dependencies only point *down*. A Layer 3 change (e.g. adding a template field) must never force a Layer 0–2 change. If you find yourself editing `Contact` to make `Template` work, stop — you've inverted a dependency and that's the bug you keep hitting.

**Contact is the keystone (Layer 0).** Everything references it. This is why Contact Management is built first and changed least. Get its shape right once.

---

## 2. V1 Data Model — migration-ready

Existing models stay as-is. New V1 models below. Conventions: `id` = cuid, `createdAt`/`updatedAt` on every table, soft-delete via `deletedAt DateTime?` on Layer 0–2 tables only.

### LeadSource  *(Layer 0 — cheap now, expensive to backfill)*
One-line purpose: which campaign / number / address a lead came from, for attribution.
| field | type | why |
|---|---|---|
| id | String @id | |
| key | String @unique | stable slug e.g. `wa_main`, `email_sales`, `fb_campaign_jan` |
| label | String | human name shown in analytics |
| channelType | ChannelType | which channel this source belongs to |
| identifier | String | the actual number/address that received the lead |
| isActive | Boolean @default(true) | |

Relations: `Enquiry.leadSourceId? → LeadSource`.
Index: `@@index([channelType, isActive])`.
Why V1: backfilling source onto historical leads is impossible. Capture from day one even if analytics is V2.

### Template / TemplateVersion / TemplateVariable  *(Layer 3)*
Purpose: reusable message bodies with variable substitution; versioned so edits don't break sent history.

**Template**
| field | type | why |
|---|---|---|
| id | String @id | |
| name | String | |
| channelType | ChannelType | a template is channel-specific (WA template ≠ email) |
| category | String? | grouping for the composer picker |
| currentVersionId | String? | points at the live version |
| isActive | Boolean @default(true) | |

**TemplateVersion**
| field | type | why |
|---|---|---|
| id | String @id | |
| templateId | String | → Template |
| versionNumber | Int | increments on edit |
| body | String | the text, with `{{variable}}` tokens |
| whatsappApprovalStatus | WaApprovalStatus? | NONE/PENDING/APPROVED/REJECTED — WA templates need Meta approval |
| createdById | String | → User |

**TemplateVariable**
| field | type | why |
|---|---|---|
| id | String @id | |
| templateVersionId | String | → TemplateVersion |
| token | String | e.g. `customer_name` |
| source | VariableSource | CONTACT_FIELD / ENQUIRY_FIELD / MANUAL — tells the composer how to fill it |
| fallback | String? | used when source value is null |

Indexes: `Template @@index([channelType, isActive])`, `TemplateVersion @@unique([templateId, versionNumber])`, `TemplateVariable @@index([templateVersionId])`.
**Opinionated call:** version the body, never edit in place. A message sent last week must always resolve to the body it was sent with.

### ScheduledMessage  *(Layer 3 — the follow-up scheduler)*
Purpose: a message queued to send at a future time; the spine of follow-ups.
| field | type | why |
|---|---|---|
| id | String @id | |
| enquiryId | String | → Enquiry |
| contactChannelId | String | → ContactChannel (which channel/address to send on) |
| createdById | String | → User (who scheduled it) |
| body | String | resolved text (or template ref below) |
| templateVersionId | String? | → TemplateVersion if built from a template |
| scheduledFor | DateTime | when to fire |
| status | ScheduledStatus | PENDING / SENT / CANCELLED / FAILED |
| bullJobId | String? | the BullMQ delayed-job id, so you can cancel it |
| cancelledReason | String? | e.g. "customer replied" — auto-cancel on reply |

Indexes: `@@index([status, scheduledFor])` (the worker's poll query), `@@index([enquiryId])`.
**Opinionated call:** when a customer replies before `scheduledFor`, auto-cancel pending follow-ups for that enquiry. The #1 way follow-up tools feel stupid is firing "just checking in!" right after the customer already answered.

### AutomationRule / AutomationExecutionLog  *(Layer 3)*
Purpose: preset if/then automations for V1. **Conditions and actions live in JSON columns** — do NOT build `AutomationCondition`/`AutomationAction` tables in V1.

**AutomationRule**
| field | type | why |
|---|---|---|
| id | String @id | |
| name | String | |
| trigger | AutomationTrigger | ENQUIRY_CREATED / STATUS_CHANGED / NO_REPLY_24H / NO_REPLY_72H / MESSAGE_RECEIVED |
| conditionsJson | Json | array of `{field, op, value}` — evaluated in code |
| actionsJson | Json | array of `{type, params}` — e.g. assign, tag, schedule follow-up, notify |
| isActive | Boolean @default(true) | the admin toggle |
| priority | Int @default(0) | execution order when multiple match |

**AutomationExecutionLog**
| field | type | why |
|---|---|---|
| id | String @id | |
| ruleId | String | → AutomationRule |
| enquiryId | String? | → Enquiry (what it acted on) |
| status | ExecStatus | SUCCESS / FAILED / SKIPPED |
| detailJson | Json | what it evaluated and did, for debugging |

Indexes: `AutomationRule @@index([trigger, isActive])`, `ExecutionLog @@index([ruleId, createdAt])`, `@@index([enquiryId])`.
**Opinionated call:** JSON now, normalized tables in V2 when you build the visual builder. Normalizing in V1 is the exact over-engineering that creates the coupling you're complaining about — four tables to add one preset rule.

### Notification  *(Layer 4 — single-tenant simplification)*
Purpose: in-app notifications. **No separate `NotificationRead` table in single-tenant** — a notification belongs to one user, so read-state is a column.
| field | type | why |
|---|---|---|
| id | String @id | |
| userId | String | → User (recipient) |
| type | NotificationType | ASSIGNED / CUSTOMER_REPLIED / MENTIONED / SLA_BREACH (reserve SLA value now) |
| enquiryId | String? | deep-link target |
| payloadJson | Json | title, body, link |
| readAt | DateTime? | null = unread |

Index: `@@index([userId, readAt])` (the bell's unread-count query).

### ContactMergeDecision  *(Layer 0 support)*
Purpose: remember "these two are NOT the same person" so merge suggestions don't nag.
| field | type | why |
|---|---|---|
| id | String @id | |
| contactAId | String | → Contact |
| contactBId | String | → Contact |
| decision | MergeDecision | MERGED / REJECTED |
| decidedById | String | → User |

Index: `@@unique([contactAId, contactBId])`.
Why V1: contact merge is part of V1 Contact Management; without this, the same false-positive pair gets re-suggested forever and agents stop trusting it.

### SystemConfig  *(Layer 4)*
Purpose: admin key-value settings (business hours, default SLA minutes, feature toggles) without a deploy.
| field | type | why |
|---|---|---|
| key | String @id | e.g. `business_hours`, `wa_channel_enabled` |
| valueJson | Json | |
| updatedById | String | → User |

Why V1: business-hours awareness and the WhatsApp/Email enable toggles need a home, and you want them editable without redeploy. Start here; the full admin panel is later.

**Deferred from V1 (mark, don't build):** `AnalyticsDailySnapshot` — only build when basic analytics ships; raw queries are fine until message volume hurts. `AiUsageLog` already exists conceptually in your qualification audit trail; expand it in V2, don't duplicate now.

---

## 3. The V2/V3 Seams — add these columns NOW

This is the actual answer to "everything breaks when I change something." These are the *only* future-facing changes worth making in V1, because they touch the hot tables (`Enquiry`, `ConversationMessage`) that are brutal to alter once they hold real data.

**On `ConversationMessage`** (add now):
- `source MessageSource @default(HUMAN)` — enum `HUMAN / AI_ASSISTED / AUTOMATION / VOICE`. Reserves V2 AI-assist and V3 voice without ever altering this table again.
- `aiSuggestionId String?` — nullable FK target for V2 AiSuggestion. Leave it null in V1.

**On `Enquiry`** (add now, all nullable):
- `leadSourceId String?` → LeadSource (V1 uses it; wire it day one).
- `aiScore Int?` + `aiScoreUpdatedAt DateTime?` — V2 lead scoring lands here, no migration.
- `estimatedValue Decimal?` — V2 deal-value estimation.
- `slaPolicyId String?` + `slaState SlaState? @default(OK)` — V2 SLA tracking; reserve `OK/AT_RISK/BREACHED`.

**On `EnquiryTimeline`** (add now):
- `actorType ActorType @default(USER)` — enum `USER / SYSTEM / AI / VOICE`. Without this, V2 automation events and V3 voice events can't log cleanly and you'll widen this table under load.

**On `ContactChannel`** (verify now): ⚠️ make sure `channelType` is an **enum you can extend** (`WHATSAPP / EMAIL` now; `SMS / INSTAGRAM / FB_MESSENGER / VOICE` reserved) and that **no code branches on a hardcoded two-value check**. The single biggest V3 rework risk is `if (channel === 'whatsapp') else email` scattered across the codebase. Centralize channel logic behind one resolver now. This is the seam that makes "add a channel from the UI" possible later without a rewrite.

**Voice (V3) needs no V1 table** — it rides existing models: `Enquiry` with `leadSource.channelType = VOICE`, `ConversationMessage.source = VOICE`. The `VoiceCall`/transcript tables get added in V3 as a *new* Layer 2 sibling; nothing existing changes. That's why it's safe to defer completely.

⚠️ **Channel registry (`Channel` table):** deferred to V3. In V1, `ChannelType` enum + the centralized resolver is enough. Building a dynamic plugin registry now is the over-engineering trap — it adds indirection to every message path for a capability you won't use for months.

---

## 4. V1 Build Order & Tracker

Build in dependency order (Layer 0 → up). Each item compiles and is usable before the next starts.

| # | Module | Layer | Status | Notes |
|---|---|---|---|---|
| 1 | Apply seams (§3) — migrations only | 0–2 | ⬜ TODO | Do this FIRST, before feature work. One migration, no logic. |
| 2 | Contact Management UI (add channel, merge, edit, notes) | 0 | ⬜ TODO | The keystone. Uses ContactMergeDecision. Blocks everything. |
| 3 | Attachment rendering in bubbles | 2 | ✅ DONE | shipped |
| 4 | Unified search (contacts + messages, one endpoint) | 2 | ⬜ TODO | |
| 5 | Draft attachment 24hr grace period | 3 | ⬜ TODO | |
| 6 | Dead code cleanup (6 unconnected outbound components) | 3 | ⬜ TODO | Delete before they confuse a future change. |
| 7 | Templates (Template/Version/Variable + composer picker) | 3 | ⬜ TODO | |
| 8 | Follow-up scheduler (ScheduledMessage + BullMQ delayed + auto-cancel-on-reply) | 3 | ⬜ TODO | |
| 9 | Basic automation (3–4 preset rules, JSON config) | 3 | ⬜ TODO | |
| 10 | Notifications (bell + unread + the 3 V1 types) | 4 | ⬜ TODO | |
| 11 | Basic analytics (volume, response time, conversion — raw queries) | 4 | ⬜ TODO | No snapshot table yet. |
| 12 | SystemConfig + business-hours awareness + channel enable toggles | 4 | ⬜ TODO | |

**V1 is shippable after #7.** Items 8–12 are upgrades you can deploy to a live customer week by week. Don't let 8–12 block the demo.

---

## 5. What I deferred and why (so you're not confused later)

- **Full V2 AI spec** (reply suggestion prompts, scoring algorithm, AiSuggestion table) — write it when V1 is stable and you've got real conversation data to design the prompt context against. Designing it now means guessing at data you don't have.
- **Full V3 voice spec** (Gemini Live, Twilio media streams, latency budget) — zero impact on V1 schema; the seams above are all V1 needs. Spec it when it's the build.
- **Visual automation builder, SLA engine, bulk campaigns, channel plugin registry, analytics snapshots, agent performance, admin god-mode panel** — all attach to the seams in §3 without reworking the core. That's the whole point: you can build V1 fast and *correctly*, and they slot in later.

The coupling problem is solved by §1 (dependency direction) + §3 (seams). Everything else is feature work that now has a stable place to land.