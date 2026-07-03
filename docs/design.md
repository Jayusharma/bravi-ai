# Enquiry Hub — Complete Product Blueprint

> Companion to `enquiry-hub-spine.md` (data model + dependency map = Section 6).
> This is the north star: what we build, in what order, and why each piece lets you charge what the cheap players can't.
> Single-tenant. Industry-agnostic (real estate, e-commerce, education, legal, healthcare, finance). Opinionated by design — where I don't give options, it's because the choice is made.

---

## SECTION 1 — PRODUCT DEFINITION

**One sentence:** Enquiry Hub captures every lead from every channel, qualifies it, assigns it, replies fast, follows up automatically, and shows the owner in real time exactly what's happening — so no lead ever falls through and every agent is accountable.

**The three problems it solves (problems, not features):**
1. **Leads die in the gap.** A WhatsApp at 11pm, replied to at 10am, is a dead lead. Response speed is the single largest lever on conversion and nobody is watching it.
2. **Nobody can see the work.** The owner has no idea who replied, what was promised, which deals are going cold, or which agent is actually performing. The business runs on hope.
3. **Knowledge walks out the door.** Conversations live in agents' personal WhatsApp. When an agent leaves, the relationships and the history leave with them.

**Measurable ROI in the first 30 days (what you put on the pitch deck):**
- First-response time on inbound leads: from hours to **under 2 minutes** (auto-acknowledge + assignment + agent alert).
- **Zero** leads with no follow-up after 24h (the scheduler guarantees it).
- **100%** of conversations retained on company infrastructure, not personal phones.
- Owner sees a live number for leads-in, response time, and pipeline value — visibility that previously **did not exist at any price** for this business.
- Realistic conversion lift in this category from speed + follow-up discipline alone: **15–30%** on the same lead volume. That's the number that justifies your price.

**The daily persona — the SALES agent, before vs after:**
- *Before:* personal WhatsApp + Gmail + a spreadsheet. Switches apps constantly, forgets follow-ups, can't see what a colleague already quoted, gets yelled at for slow replies they never saw.
- *After:* one screen. New lead pops in assigned to them, AI has drafted a reply, the customer's full history is right there, follow-ups schedule themselves, and their numbers are visible — so good work gets seen.

**What this is NOT (the boundaries that keep us focused):**
- Not multi-tenant SaaS. One business, deployed and run by us (SAP model).
- Not a marketing/campaign blast tool. Bulk exists for re-engagement, not spray-and-pray.
- Not a full ERP/accounting/inventory system. It owns the *conversation-to-conversion* slice and integrates outward later, it doesn't absorb everything.
- Not a social media manager. Channels are for 1:1 sales conversations, not content posting.

---

## SECTION 2 — COMPLETE FEATURE MAP

Format: **Feature — description — pain it kills — measurable impact — who — version — priority.**

### Module A — Contact & Identity
- **Full contact management UI** — add/edit channels, notes, tags on one contact. *Kills:* fragmented identity. *Impact:* one source of truth per customer. ADMIN/MANAGER/SALES · V1 · CORE
- **Cross-channel merge + merge-decision memory** — one person on WhatsApp and email becomes one contact; rejected matches never re-suggest. *Kills:* duplicate leads, agents not knowing it's the same person. *Impact:* eliminates double-contact embarrassment, ~5% of leads. SALES/MANAGER · V1 · CORE
- **Unified contact timeline** — every interaction across all enquiries, channels, and agents in one view. *Kills:* "customer repeats themselves every time." *Impact:* zero context-loss on returning customers. ALL · V1 · CORE
- **Lead source attribution** — which number/address/campaign produced this lead. *Kills:* "no idea which marketing works." *Impact:* makes spend measurable. MANAGER/ADMIN · V1 · GROWTH

### Module B — Inbox & Conversation
- **Unified multi-channel inbox** — WhatsApp + Email (later SMS/IG/FB) in one stream. *Kills:* app-switching. *Impact:* ~30–60 min/agent/day saved. SALES · V1 · CORE
- **Agent collision detection** — warns when two agents open/type to the same customer. *Kills:* two agents quoting different prices. *Impact:* prevents the single most damaging customer-trust failure. SALES/MANAGER · V1 · CORE
- **Delivery + read tracking** — PENDING→SENT→DELIVERED→READ→FAILED on every message. *Kills:* "did it even send?" *Impact:* removes guesswork, surfaces failures instantly. SALES · V1 (built) · CORE
- **Internal notes + @mentions** — private agent-to-agent context on an enquiry. *Kills:* lost verbal handoffs. *Impact:* clean handoffs, no re-briefing. ALL · V1 · CORE
- **Business-hours awareness** — agent sees "outside hours," customer gets auto-acknowledge. *Kills:* silence at night, midnight follow-ups. *Impact:* every after-hours lead gets an instant touch. SALES · V1 · GROWTH

### Module C — Sales Pipeline
- **Enquiry state machine** — NEW→OPEN→IN_PROGRESS→AWAITING_CUSTOMER→QUOTATION_SENT→FOLLOW_UP→STALE→CONVERTED/CLOSED_LOST. *Kills:* "where is this deal?" *Impact:* every lead has a known state. ALL · V1 (built) · CORE
- **Kanban + list pipeline view** — drag between stages, full filtering. *Kills:* spreadsheet pipeline. *Impact:* replaces the tool they hate. MANAGER/SALES · V1 · CORE
- **Loss-reason capture** — mandatory reason on CLOSED_LOST. *Kills:* "no idea why we lose deals." *Impact:* turns losses into data. MANAGER · V1 · GROWTH
- **Smart assignment** — round-robin / by topic / by language / by geography. *Kills:* agents cherry-picking easy leads; wrong-agent routing. *Impact:* balanced load, right expert on right lead. MANAGER · V2 · GROWTH

### Module D — Outbound, Templates & Follow-up
- **Draft system (debounce autosave, attachments, grace period)** — never lose a half-written reply. *Kills:* lost drafts. SALES · V1 (built; grace-period fix pending) · CORE
- **Templates with versioning + variables** — reusable, approved, personalized message bodies. *Kills:* retyping, off-brand replies, inconsistent answers. *Impact:* faster replies, brand consistency. SALES · V1 · CORE
- **Follow-up scheduler (auto-cancel on reply)** — queue a future message; cancels itself if the customer replies first. *Kills:* forgotten follow-ups AND dumb "just checking in" after they already answered. *Impact:* 0 leads un-followed; no follow-up spam. SALES · V1 · CORE
- **Preset automations** — on-event if/then (assign, tag, schedule, notify). *Kills:* manual routine work. *Impact:* removes repetitive ops. MANAGER/ADMIN · V1 · GROWTH

### Module E — Intelligence (V2)
- **AI reply suggestion** — context-aware draft the agent accepts/edits/rejects. *Kills:* slow/blank-page replies. *Impact:* ~40–60% faster first reply on complex leads. SALES · V2 · GROWTH
- **Lead scoring** — 0–100 hotness from conversation signals. *Kills:* agents working cold leads while hot ones rot. *Impact:* prioritized attention = higher conversion. SALES/MANAGER · V2 · GROWTH
- **Sentiment trajectory** — is this lead warming or cooling over time. *Kills:* deals quietly going cold. *Impact:* early-warning saves at-risk deals. MANAGER · V2 · GROWTH
- **Reply-in-same-language suggestion** — detects language, drafts in it. *Kills:* language friction. *Impact:* serves multilingual markets natively. SALES · V2 · GROWTH
- **Deal value estimation** — AI estimates deal size from content. *Kills:* flat pipeline with no value view. *Impact:* owner sees revenue-at-risk, not just count. MANAGER/ADMIN · V2 · GROWTH
- **Competitor & price-sensitivity detection** — flags competitor mentions and price-shy buyers, suggests approach. *Kills:* losing on price/competition silently. *Impact:* arms the agent at the decisive moment. SALES · V2 · GROWTH
- **Re-engagement campaigns** — auto-sequence for contacts cold 30/60/90 days. *Kills:* dead pipeline left for dead. *Impact:* recovers a % of written-off leads at near-zero cost. MANAGER · V2 · SCALE

### Module F — Visibility & Control
- **Live owner dashboard** — leads in, response time, hot leads, follow-ups due, pipeline value, agent performance. *Kills:* flying blind. *Impact:* the activation moment. ADMIN/MANAGER · V1 (basic) → V2 (full) · CORE
- **SLA tracking + breach alerts** — response-time SLA per stage; alert manager on breach. *Kills:* slow replies nobody catches. *Impact:* enforces speed automatically. MANAGER · V2 · GROWTH
- **Agent performance analytics** — objective response time, volume, conversion by agent. *Kills:* "no way to compare agents fairly." *Impact:* performance management on facts. MANAGER · V2 · GROWTH
- **Channel/feature analytics** — best channel, peak hours, top products, top questions. *Kills:* no insight into demand. *Impact:* informs marketing + staffing. ADMIN · V2 · GROWTH
- **Admin god-mode control panel** — every channel/feature is a toggle; system health; usage + cost. *Kills:* no central control. *Impact:* run the whole comms function from one screen. ADMIN · V2→V3 · SCALE

### Module G — Voice & Platform (V3)
- **Inbound voice AI agent** — answers calls, qualifies, creates enquiry, escalates with summary. *Kills:* missed calls = missed leads. *Impact:* every call answered 24/7. ALL · V3 · SCALE
- **Channel plugins from UI** — add SMS/IG/FB/Slack without deployment. *Kills:* dev work for every new channel. *Impact:* new channel live in minutes. ADMIN · V3 · SCALE

---

## SECTION 3 — VERSION BLUEPRINT

### VERSION 1 — UNIFIED SALES INBOX
**Core capability:** WhatsApp + Email in one inbox, every lead tracked, every agent accountable, manager has visibility, nothing falls through.
**Replaces:** WhatsApp Business app + Gmail-for-sales + spreadsheet pipeline.

**Build sequence (each step compiles on the last; ties to spine tracker):**
- **Week 0:** apply schema seams (spine §3). One migration, no logic.
- **Week 1–2:** Contact Management UI (keystone) — add/merge/edit/notes + merge-decision memory.
- **Week 2:** Unified search; attachment grace-period fix; delete dead outbound code.
- **Week 3:** Templates (create, version, variables, composer picker).
- **Week 4:** Follow-up scheduler (ScheduledMessage + BullMQ delayed + auto-cancel-on-reply).
- **Week 5:** Preset automations (3–4 rules) + agent collision detection.
- **Week 6:** Pipeline view (kanban + list + filters) + loss-reason capture.
- **Week 7:** Basic owner dashboard (volume, response time, conversion — raw queries) + business-hours awareness + SystemConfig toggles + notifications.

**→ V1 is demoable end-to-end at Week 7. This is the trigger to start selling.**

**Day-1 agent experience:** logs in, sees their assigned leads in one inbox, replies with a template, schedules a follow-up that will cancel itself if the customer answers, never touches a spreadsheet.

**Activation moment (owner):** opens the dashboard and sees, for the first time ever, live first-response times per agent and how many leads came in today. That's the "this is exactly what I needed" beat.

**Retention hook:** after a week, the team's conversations, history, and follow-ups all live in here. Going back to personal WhatsApp means losing the timeline, the accountability, and the follow-up safety net. They can't.

**Data V1 collects that makes V2 devastating:** every message, response time, state transition, loss reason, lead source, and conversation outcome. That labeled history is the training/context substrate for scoring, suggestions, and sentiment in V2. **You cannot build V2 well without V1 having run for weeks first** — another reason build-first is right.

**The 10-minute demo that closes:** (1) send a WhatsApp to their number → watch it appear, assigned, acknowledged in seconds. (2) Reply with a template, schedule a follow-up. (3) Reply *as the customer* → follow-up auto-cancels. (4) Open the pipeline, drag a card, mark one lost with a reason. (5) Open the dashboard → live response time and lead count. End on: "every lead your team got this month that went unanswered — this is the last month that happens."

### VERSION 2 — AI SALES INTELLIGENCE
**Core capability:** AI suggests replies, scores leads, detects sentiment/competitor/price signals, automates follow-ups, and tells the manager which deals are about to close or die.
**Adds on top of V1:** the output of a $50k/yr analyst team, automatic.
**Upgrade trigger from V1:** V1 makes response *fast*; it does not make replies *smart* or tell you *which* lead to chase first. Once the team is fast, the next bottleneck is judgment and prioritization — exactly what V2 sells.
**Ships:** AI reply suggestion, lead scoring, sentiment trajectory, deal-value estimation, competitor/price detection, re-engagement campaigns, full analytics, SLA engine, smart assignment.

### VERSION 3 — VOICE & PLATFORM
**Core capability:** AI answers inbound calls, qualifies, captures, creates the enquiry, and either resolves or hands to the right agent with a full summary; new channels added from the admin UI.
**Upgrade trigger from V2:** V2 handles text brilliantly; calls still go to voicemail = lost leads. V3 closes the last channel and makes the system the OS for all customer comms.

---

## SECTION 4 — THE FEATURES NOBODY ELSE HAS (your premium thesis)

The cheap WhatsApp-CRM players win on price and lose on depth. These five, **in combination**, are why you charge what they can't. Each: what · why uncopyable combo · technical approach · 2-sentence pitch · version · proof metric.

1. **Auto-cancelling follow-up that respects the conversation.** Follow-ups cancel themselves the instant the customer replies. *Why rare:* most tools fire scheduled blasts blind to inbound state; doing it right needs the scheduler wired into the live message pipeline. *Tech:* on inbound `ConversationMessage`, query `ScheduledMessage` PENDING for that enquiry, cancel the BullMQ job, log reason. *Pitch:* "Your follow-ups never fire after a customer already replied — so you look attentive, never robotic. No competitor's scheduler even knows the customer answered." *Version:* V1. *Proof:* % of scheduled follow-ups auto-cancelled (every one is an avoided embarrassment).

2. **Agent collision prevention.** Two agents can't unknowingly quote the same customer different prices. *Why rare:* requires real-time presence at the *conversation* level, not just login presence. *Tech:* WebSocket contact-rooms + presence; on open/type, broadcast to room, warn others. *Pitch:* "Two of your people will never again send the same customer two different prices. Your competitors find out about collisions from angry customers." *Version:* V1. *Proof:* collision warnings shown vs price-conflict complaints (→0).

3. **Deal-value-weighted pipeline.** Pipeline ranked by AI-estimated revenue at risk, not just count or date. *Why rare:* needs conversation-content LLM estimation fused with stage data. *Tech:* Gemini estimates value from conversation → `Enquiry.estimatedValue` → pipeline sorts by value × cool-down risk. *Pitch:* "Your team chases the $40k deal going cold before the $400 one. Other CRMs show you a list; this shows you where the money is." *Version:* V2. *Proof:* recovered at-risk pipeline value/month.

4. **Sentiment trajectory early-warning.** Flags deals *cooling* before they're lost, while still saveable. *Why rare:* needs per-message sentiment tracked as a time series, not a one-shot label. *Tech:* sentiment score per inbound message, trend over the enquiry, alert on sustained decline. *Pitch:* "You get pinged the moment a hot lead starts going cold — days before they ghost. Nobody else watches the *direction* of the relationship." *Version:* V2. *Proof:* at-risk deals saved after alert.

5. **Single-tenant + voice AI on owned infrastructure.** The whole system runs as *their* system, including an AI that answers *their* calls — not a shared SaaS seat. *Why rare:* the cheap players are multi-tenant by necessity and bolt voice on as a third-party redirect; you deploy a dedicated stack with Gemini Live wired into Twilio Voice. *Tech:* see Section 5. *Pitch:* "Your business gets its own system and its own AI receptionist that never sleeps — not a shared tool 500 other companies log into. That's a category they can't reach at their price." *Version:* V3. *Proof:* calls answered 24/7 vs prior voicemail rate.

---

## SECTION 5 — AI ARCHITECTURE

**Model choice (cost vs capability):**
- **Gemini Flash:** qualification classify, language detect, sentiment-per-message, value estimate, reply *suggestions*. High volume, latency-sensitive, cheap. This is 90% of calls.
- **Gemini Pro:** weekly pattern mining (which AI patterns should become qualification rules), complex multi-message summarization. Low volume, quality-sensitive.
- **Gemini Live (multimodal):** voice agent only (V3).

**Prompt architecture (every AI feature follows this contract):**
- **Context built:** system role + business profile (from SystemConfig) + last N messages of the enquiry + extracted contact facts + the specific task instruction.
- **Output:** strict JSON schema, validated on receipt; on parse failure, one retry then graceful skip (feature silently degrades, never blocks the agent).
- *Reply suggestion end-to-end:* trigger (agent opens composer on inbound) → build context (thread + contact timeline + matching templates) → Flash call → display as dismissible suggestion → agent accepts/edits/rejects → store outcome in `AiSuggestion`.

**Feedback loop:** every suggestion stores `shown / accepted / edited / rejected` + the final sent text. Edit-distance between suggestion and sent message is the quality signal. Weekly Pro job reviews high-reject patterns and proposes prompt/rule adjustments for your review.

**Usage tracking (expand existing audit trail):** every call logs feature, model, input/output tokens, USD cost, user, enquiry, latency, and whether the agent used the result. This is what makes cost defensible and per-feature ROI visible.

**Cost controls:** daily cap + per-feature cap + per-user cap in SystemConfig. As a cap is approached: warn admin → degrade (Pro→Flash, then suggestions off) before any hard stop. The system never breaks because of cost; it gets quietly less smart and tells you.

**Voice flow (V3):** Twilio Voice webhook → media stream → Gemini Live (STT+reason+TTS in-loop) → audio back to caller, target **<1s** perceived latency via streaming partials. Escalation triggers: explicit human request, low confidence, high estimated value, or detected frustration → warm transfer with transcript + summary + suggested next step pushed to the agent in real time. Post-call: store transcript + segments, generate summary, create/attach enquiry, schedule follow-up.

---

## SECTION 6 — DATA ARCHITECTURE
See **`enquiry-hub-spine.md`** — complete V1 models, V2/V3 seams, indexes, relations, build tracker. That document is authoritative for schema.

---

## SECTION 7 — ADMIN CONTROL PANEL

**Toggles (each: what it controls · effect when off · who · confirm?):**
- WhatsApp channel — all WA in/out · inbound rejected-with-log, outbound queue paused · ADMIN · confirm.
- Email channel — same for email · ADMIN · confirm.
- AI qualification — auto-classify inbound · falls back to manual review queue · ADMIN · no.
- AI reply suggestions — composer suggestions · composer goes manual · ADMIN/MANAGER · no.
- AI voice agent (V3) — inbound call answering · calls route to human/voicemail · ADMIN · confirm.
- Each automation rule — that rule's firing · rule dormant, logged · MANAGER · no.
- Per-feature usage caps — daily AI/bulk limits · degrade then block · ADMIN · no.

**System health (real-time):** BullMQ depth per queue · failed jobs last hour · webhook health per channel (last received + success rate) · active WebSocket connections · AI latency + error rate · DB pool status.

**Usage dashboard:** messages sent today per channel · AI calls today (count + USD) · leads today vs yesterday vs same-day-last-week · avg response time today · agents online now.

**Channel management:** add channel (per-type credential fields) · configure (creds/webhooks/limits) · disable (in-flight messages drain, no new accepted) · health (delivery + error rate per channel).

---

## SECTION 8 — THE SALES PIPELINE VIEW

This is a sales system, not a chat app — the pipeline is co-equal with the inbox.
- **Visual:** both. Kanban as default (columns = states), list view for power filtering. Toggle between them.
- **Card shows:** contact name, channel icon, last-message age, owner, stage, lead source, value estimate (V2), AI score (V2), SLA status dot (V2).
- **Movement:** drag manually; auto-transitions on triggers (quotation sent → QUOTATION_SENT; no reply 72h → STALE; converted/lost manual with reason).
- **Manager-only:** all agents' pipelines at once, workload balance, SLA breaches, performance overlay.
- **Connects to conversation:** click card → opens that enquiry's thread in-context.
- **Filters:** agent, channel, tag, date, AI score, SLA status, lead source.
- **Pipeline analytics:** conversion rate per stage, avg time in stage, bottleneck stage flagged (where deals stall longest).

---

## SECTION 9 — TECHNICAL RISKS

| # | Risk | Critical at | Prevention | Now vs defer |
|---|---|---|---|---|
| 1 | WhatsApp 24h window + template policy violations → number ban | V1 | Enforce 24h-window detection; only approved templates outside window; block non-compliant sends | **Now** |
| 2 | Gemini rate limits / cost spike | V2 | Per-feature/user/day caps + degrade ladder; cache classifications | Caps now, full ladder V2 |
| 3 | BullMQ/Redis loses a scheduled follow-up | V1 | Persist `ScheduledMessage` in Postgres as source of truth; Redis only executes; reconcile job on boot | **Now** |
| 4 | Socket performance with many concurrent agents | V2 | Room-scoped emits only (never broadcast-all); presence throttled; single gateway already in place | Pattern now |
| 5 | Message table growth kills queries | V2/scale | Indexes per spine; partition/archive by date when volume hurts | Indexes now, archive deferred |
| 6 | Voice latency >1s | V3 | Gemini Live streaming partials; regional Twilio; pre-warmed sessions | Defer to V3 |
| 7 | CASL complexity as features grow | V2 | Centralize ability definitions; one permission map, tested | Discipline now |
| 8 | Duplicate webhook delivery | V1 | Idempotency keys (already built) — verify coverage on every new inbound path | **Now** |
| 9 | One agent's bad AI experience kills trust in AI | V2 | Suggestions always dismissible, never auto-send; track reject rate, tune fast | V2 |
| 10 | Single-tenant deploy/ops burden per customer | V1→scale | Scripted deploy + health monitoring in admin panel; standardize the stack | Script before customer #2 |

---

## SECTION 10 — EXECUTION MODEL (one dev + Claude Code)

**Per-module workflow:** read actual codebase → plan with Opus (present plan, you approve, *no code yet*) → implement step-by-step with Sonnet → verify each PR compiles before the next. (This is the loop you already run — keep it.)

**Sequential vs parallel:** Layer 0–2 strictly sequential (Contact → search → pipeline). Layer 3 features (templates, scheduler, automations) can interleave once contacts are solid. Layer 4 (dashboard, notifications) last.

**Ruthless minimum V1 if time is short — cut in this order:** drop preset automations (#9), drop loss-reason mandatory (make optional), drop notifications (poll instead of push). **Never cut:** contact mgmt, inbox, pipeline, follow-up scheduler. Those four *are* the product.

**First production bug:** triage by blast radius — does it lose data or block sending? If yes, hotfix immediately, post-mortem after. If no, log it, batch it. You're solo; protect data integrity and send reliability above all else.

**Metrics from day 1 (prove ROI):** first-response time, % leads followed-up within 24h, conversion rate, lead volume by source. These are both your product KPIs and your sales deck.

**Usage → product loop:** weekly, review the dashboard with the customer; every "I wish it did X" goes to a backlog tagged by version. Don't build it mid-V1 — it goes in the map.

**When V1 is stable enough to start V2:** two weeks of live use with no data-loss/send-reliability bugs, and the team using it daily without reverting to WhatsApp. Stability before intelligence.

---

*Section 6 lives in the spine. Build order lives in the spine tracker. This document is the why and the what; the spine is the how. Together they're the north star.*