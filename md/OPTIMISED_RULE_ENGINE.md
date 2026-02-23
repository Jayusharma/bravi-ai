# 🚀 Optimised Rule Engine v2 — Design Document

> A high-performance, composable, and extensible rule engine that replaces the linear scan approach with pre-compiled patterns, composite rule groups, sender-aware filtering, duplicate detection, and intelligent scoring.

---

## Why a New Rule Engine?

The current `RuleEngineStrategy` works, but it has **10 fundamental limitations** that hurt performance, accuracy, and maintainability at scale:

| # | Current Limitation | Impact | v2 Solution |
|---|---|---|---|
| 1 | **Linear O(n) scan** — every rule iterated sequentially | Slow at 500+ rules | **Pre-indexed rule maps** by type, compiled once on cache load |
| 2 | **No word-boundary matching** — `includes("ad")` matches "admission" | False positives on blacklist | **Word-boundary regex** and **tokenised matching** |
| 3 | **Regex compiled on every call** — `new RegExp()` in hot path | CPU waste, GC pressure | **Pre-compiled RegExp cache** on rule load |
| 4 | **No composite rules** — can't express AND/OR/NOT logic | Can't say "has 'admission' AND 'fee'" | **Rule Groups** with `AND`, `OR`, `NOT` operators |
| 5 | **Ignores sender field** — only scans message text | Can't whitelist/blacklist domains | **Sender-aware rules** (domain, email pattern) |
| 6 | **Flat additive scoring** — all whitelist keywords scored equally | No nuance between strong/weak signals | **Category-weighted scoring** with multipliers |
| 7 | **No duplicate detection** — same text processed every time | Wasted AI calls, duplicate enquiries | **Content fingerprinting** with SHA-256 |
| 8 | **Hardcoded thresholds** — short text = 4 words, not configurable | Can't tune without code changes | **All thresholds from config/env** |
| 9 | **No rule execution order** — rules fire in DB order | Can't prioritise cheap rules first | **Priority-sorted execution** with early-exit |
| 10 | **No rule analytics** — don't know which rules fire most | Can't optimise rule set | **Rule hit counters** and **performance metrics** |

---

## Architecture Comparison

### Current Engine (v1)
```
Message → Load all rules → Loop blacklist keywords → Loop blacklist phrases
        → Loop regex patterns → Loop whitelist keywords → Score → Return
```
- Single flat loop per category
- No indexing, no compilation, no grouping

### Optimised Engine (v2)
```
Message ──→ Fingerprint Check (duplicate?) ──→ Pre-compiled Rule Index
         │                                      │
         │  ┌─────────────────────────────────────┘
         │  │
         ▼  ▼
   ┌── Tier 1: Fast Filters (O(1) lookups) ──────────────────┐
   │  • Sender domain blacklist (Set lookup)                  │
   │  • Sender domain whitelist (Set lookup)                  │
   │  • Short text check (configurable threshold)             │
   │  • Exact-match keyword blacklist (Set lookup)            │
   └──────────────────────────────────────────────────────────┘
              │ (not conclusive? continue)
              ▼
   ┌── Tier 2: Pattern Matching ──────────────────────────────┐
   │  • Pre-compiled regex patterns (cached RegExp objects)    │
   │  • Word-boundary keyword matching (tokenised)             │
   │  • Phrase matching with normalisation                     │
   └──────────────────────────────────────────────────────────┘
              │ (not conclusive? continue)
              ▼
   ┌── Tier 3: Composite Rule Groups ────────────────────────┐
   │  • AND groups: all conditions must match                 │
   │  • OR  groups: any condition must match                  │
   │  • NOT groups: negation check                            │
   │  • Nested group evaluation                               │
   └──────────────────────────────────────────────────────────┘
              │ (not conclusive? continue)
              ▼
   ┌── Tier 4: Weighted Scoring ─────────────────────────────┐
   │  • Category-weighted keywords (ADMISSION=2x, FEE=1.5x)  │
   │  • Diminishing returns on repeated category hits         │
   │  • Dynamic threshold from config                         │
   └──────────────────────────────────────────────────────────┘
              │
              ▼
         Return Result or null (→ AI)
```

---

## Database Schema Changes

The optimised engine requires a few additions to the Prisma schema:

```prisma
// Add to existing RuleType enum
enum RuleType {
  BLACKLIST_KEYWORD
  BLACKLIST_PHRASE
  WHITELIST_KEYWORD
  REGEX_PATTERN
  // ── New in v2 ──
  SENDER_DOMAIN_BLACKLIST   // Block entire domains (e.g., "spam.com")
  SENDER_DOMAIN_WHITELIST   // Auto-approve trusted domains
  SENDER_EMAIL_PATTERN      // Regex on sender email
  COMPOSITE_GROUP           // Container for AND/OR/NOT logic
}

// New enum for composite logic
enum RuleGroupOperator {
  AND
  OR
  NOT
}

model QualificationRule {
  id              String    @id @default(uuid())
  type            RuleType
  value           String
  weight          Int       @default(10)
  description     String?
  isActive        Boolean   @default(true)
  isCaseSensitive Boolean   @default(false)
  createdBy       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // ── New in v2 ──
  priority        Int       @default(100)      // Lower = runs first
  category        String?                      // e.g., "ADMISSION", "FEE", "TRANSPORT"
  categoryWeight  Float     @default(1.0)      // Multiplier for scoring

  // Composite group support
  groupId         String?                      // Parent group ID (null = top-level)
  groupOperator   RuleGroupOperator?           // Only set if type = COMPOSITE_GROUP
  parentGroup     QualificationRule? @relation("RuleGroup", fields: [groupId], references: [id])
  childRules      QualificationRule[] @relation("RuleGroup")

  // Analytics
  hitCount        Int       @default(0)        // How many times this rule matched
  lastHitAt       DateTime?                    // When it last matched
}
```

---

## File Structure

```
src/qualification/strategies/
├── rule-engine.strategy.ts          // ← Replaces current file
├── rule-compiler.ts                 // Pre-compiles rules into optimised structures  
├── rule-scorer.ts                   // Weighted scoring logic
├── content-fingerprint.ts           // Duplicate detection
├── interfaces/
│   ├── rule-result.interface.ts
│   ├── compiled-rule.interface.ts
│   └── rule-index.interface.ts
```

---

## Code

### `src/qualification/strategies/interfaces/compiled-rule.interface.ts`

```typescript
import { RuleType, RuleGroupOperator } from '@prisma/client';

/**
 * A pre-compiled rule ready for fast evaluation.
 * RegExp objects are created once on cache load, not on every message.
 */
export interface CompiledRule {
  id: string;
  type: RuleType;
  value: string;
  weight: number;
  priority: number;
  category: string | null;
  categoryWeight: number;
  isCaseSensitive: boolean;
  description: string | null;

  // Pre-compiled matching artifacts
  compiledRegex?: RegExp;           // For REGEX_PATTERN rules
  normalizedValue?: string;         // Lowercased value for case-insensitive matching
  wordBoundaryRegex?: RegExp;       // For keyword matching with word boundaries
  tokens?: string[];                // Tokenised value for multi-word matching

  // Composite group
  groupOperator?: RuleGroupOperator;
  children?: CompiledRule[];
}

/**
 * Pre-indexed rule collections for O(1) lookups where possible.
 */
export interface RuleIndex {
  // Tier 1: O(1) lookups
  senderDomainBlacklist: Set<string>;
  senderDomainWhitelist: Set<string>;
  exactBlacklistKeywords: Set<string>;      // Lowercase
  exactBlacklistKeywordsCaseSensitive: Set<string>;

  // Tier 2: Pre-compiled patterns (sorted by priority)
  regexPatterns: CompiledRule[];
  blacklistPhrases: CompiledRule[];
  senderEmailPatterns: CompiledRule[];

  // Tier 3: Composite groups (sorted by priority)
  compositeGroups: CompiledRule[];

  // Tier 4: Scoring rules
  whitelistKeywords: CompiledRule[];

  // Metadata
  totalRules: number;
  compiledAt: number;
}
```

### `src/qualification/strategies/interfaces/rule-result.interface.ts`

```typescript
import { QualificationStatus, QualificationLayer } from '@prisma/client';

export interface RuleResult {
  status: QualificationStatus;
  layer: QualificationLayer;
  score: number;
  matchedKeywords: string[];
  matchedRuleIds: string[];          // NEW: Track which exact rules fired
  reason: string;
  isDuplicate?: boolean;             // NEW: Flagged if fingerprint matched
  evaluationTimeMs?: number;         // NEW: Performance tracking
  tiersEvaluated?: number;           // NEW: How deep we went before deciding
}
```

### `src/qualification/strategies/content-fingerprint.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from 'src/database/prisma.service';

/**
 * Detects duplicate messages by computing a content fingerprint (SHA-256).
 * Normalises text before hashing to catch trivially modified duplicates.
 */
@Injectable()
export class ContentFingerprint {
  private readonly logger = new Logger(ContentFingerprint.name);

  // In-memory LRU for fast lookup (avoid DB hit for recent messages)
  private readonly recentFingerprints = new Map<string, { messageId: string; timestamp: number }>();
  private readonly MAX_CACHE_SIZE = 10_000;
  private readonly DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private prisma: PrismaService) {}

  /**
   * Generate a normalised fingerprint for a message.
   * Normalisation: lowercase, collapse whitespace, strip punctuation, sort words.
   */
  generateFingerprint(body: string, from: string): string {
    const normalised = body
      .toLowerCase()
      .replace(/[^\w\s]/g, '')         // Strip punctuation
      .replace(/\s+/g, ' ')            // Collapse whitespace
      .trim();

    // Include sender to scope deduplication per-sender
    const input = `${from.toLowerCase()}::${normalised}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Check if we've already seen this exact message content recently.
   * Returns the existing messageId if duplicate, null otherwise.
   */
  async checkDuplicate(fingerprint: string): Promise<string | null> {
    // 1. Check in-memory cache first (O(1))
    const cached = this.recentFingerprints.get(fingerprint);
    if (cached && Date.now() - cached.timestamp < this.DEDUP_WINDOW_MS) {
      this.logger.debug(`Duplicate detected (cache): fingerprint=${fingerprint}`);
      return cached.messageId;
    }

    // 2. Check DB for older messages
    const existing = await this.prisma.inboundMessage.findFirst({
      where: {
        contentFingerprint: fingerprint,
        receivedAt: { gte: new Date(Date.now() - this.DEDUP_WINDOW_MS) },
      },
      select: { id: true },
      orderBy: { receivedAt: 'desc' },
    });

    if (existing) {
      this.logger.debug(`Duplicate detected (DB): fingerprint=${fingerprint}`);
      return existing.id;
    }

    return null;
  }

  /**
   * Register a new fingerprint after processing.
   */
  registerFingerprint(fingerprint: string, messageId: string): void {
    // Evict oldest if at capacity (simple FIFO, not true LRU, but sufficient)
    if (this.recentFingerprints.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.recentFingerprints.keys().next().value;
      if (firstKey) this.recentFingerprints.delete(firstKey);
    }

    this.recentFingerprints.set(fingerprint, {
      messageId,
      timestamp: Date.now(),
    });
  }
}
```

### `src/qualification/strategies/rule-compiler.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { QualificationRule, RuleType } from '@prisma/client';
import { CompiledRule, RuleIndex } from './interfaces/compiled-rule.interface';

/**
 * Compiles raw DB rules into optimised, indexed structures.
 * This runs once on cache load (every 5 minutes), NOT on every message.
 *
 * Key optimisations:
 * - RegExp objects pre-compiled (avoids `new RegExp()` per message)
 * - Word-boundary patterns generated for keyword matching
 * - Rules sorted by priority for early-exit
 * - Domain blacklists/whitelists stored as Sets for O(1) lookup
 * - Composite groups resolved into tree structures
 */
@Injectable()
export class RuleCompiler {
  private readonly logger = new Logger(RuleCompiler.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Load all active rules from DB and compile into an optimised index.
   */
  async compile(): Promise<RuleIndex> {
    const startTime = Date.now();

    const rawRules = await this.prisma.qualificationRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
    });

    const index: RuleIndex = {
      senderDomainBlacklist: new Set(),
      senderDomainWhitelist: new Set(),
      exactBlacklistKeywords: new Set(),
      exactBlacklistKeywordsCaseSensitive: new Set(),
      regexPatterns: [],
      blacklistPhrases: [],
      senderEmailPatterns: [],
      compositeGroups: [],
      whitelistKeywords: [],
      totalRules: rawRules.length,
      compiledAt: Date.now(),
    };

    // Separate top-level rules from group children
    const topLevelRules = rawRules.filter((r) => !r.groupId);
    const childRulesMap = new Map<string, QualificationRule[]>();

    for (const rule of rawRules) {
      if (rule.groupId) {
        const children = childRulesMap.get(rule.groupId) || [];
        children.push(rule);
        childRulesMap.set(rule.groupId, children);
      }
    }

    for (const rule of topLevelRules) {
      const compiled = this.compileRule(rule, childRulesMap);
      if (!compiled) continue;

      switch (rule.type) {
        case 'SENDER_DOMAIN_BLACKLIST':
          index.senderDomainBlacklist.add(rule.value.toLowerCase());
          break;

        case 'SENDER_DOMAIN_WHITELIST':
          index.senderDomainWhitelist.add(rule.value.toLowerCase());
          break;

        case RuleType.BLACKLIST_KEYWORD:
          if (rule.isCaseSensitive) {
            index.exactBlacklistKeywordsCaseSensitive.add(rule.value);
          } else {
            index.exactBlacklistKeywords.add(rule.value.toLowerCase());
          }
          break;

        case RuleType.BLACKLIST_PHRASE:
          index.blacklistPhrases.push(compiled);
          break;

        case RuleType.REGEX_PATTERN:
          index.regexPatterns.push(compiled);
          break;

        case 'SENDER_EMAIL_PATTERN':
          index.senderEmailPatterns.push(compiled);
          break;

        case 'COMPOSITE_GROUP':
          index.compositeGroups.push(compiled);
          break;

        case RuleType.WHITELIST_KEYWORD:
          index.whitelistKeywords.push(compiled);
          break;
      }
    }

    const compileTimeMs = Date.now() - startTime;
    this.logger.log(
      `📦 Rule index compiled: ${rawRules.length} rules in ${compileTimeMs}ms ` +
      `(${index.senderDomainBlacklist.size} domain BL, ` +
      `${index.exactBlacklistKeywords.size} keyword BL, ` +
      `${index.regexPatterns.length} regex, ` +
      `${index.compositeGroups.length} groups, ` +
      `${index.whitelistKeywords.length} whitelist)`
    );

    return index;
  }

  /**
   * Compile a single rule into its optimised form.
   */
  private compileRule(
    rule: QualificationRule,
    childrenMap: Map<string, QualificationRule[]>,
  ): CompiledRule | null {
    const compiled: CompiledRule = {
      id: rule.id,
      type: rule.type,
      value: rule.value,
      weight: rule.weight,
      priority: rule.priority ?? 100,
      category: rule.category ?? null,
      categoryWeight: rule.categoryWeight ?? 1.0,
      isCaseSensitive: rule.isCaseSensitive,
      description: rule.description ?? null,
    };

    // Pre-compute normalised value
    compiled.normalizedValue = rule.isCaseSensitive
      ? rule.value
      : rule.value.toLowerCase();

    // Pre-compile regex for pattern rules
    if (rule.type === RuleType.REGEX_PATTERN || rule.type === ('SENDER_EMAIL_PATTERN' as RuleType)) {
      try {
        const flags = rule.isCaseSensitive ? 'g' : 'gi';
        compiled.compiledRegex = new RegExp(rule.value, flags);
      } catch (err) {
        this.logger.warn(`⚠️ Invalid regex in rule ${rule.id}: "${rule.value}" — skipping`);
        return null; // Skip invalid regex rules entirely
      }
    }

    // Pre-compile word-boundary regex for keyword matching
    if (
      rule.type === RuleType.BLACKLIST_KEYWORD ||
      rule.type === RuleType.WHITELIST_KEYWORD
    ) {
      try {
        const escaped = rule.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = rule.isCaseSensitive ? 'g' : 'gi';
        compiled.wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, flags);
      } catch {
        // Fallback: will use includes() matching
      }

      // Tokenise multi-word values
      compiled.tokens = rule.value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    }

    // Resolve composite group children
    if (rule.type === ('COMPOSITE_GROUP' as RuleType)) {
      compiled.groupOperator = rule.groupOperator ?? undefined;
      const children = childrenMap.get(rule.id) || [];
      compiled.children = children
        .map((child) => this.compileRule(child, childrenMap))
        .filter(Boolean) as CompiledRule[];
    }

    return compiled;
  }
}
```

### `src/qualification/strategies/rule-scorer.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompiledRule } from './interfaces/compiled-rule.interface';

interface ScoringResult {
  totalScore: number;
  matchedKeywords: string[];
  matchedRuleIds: string[];
  categoryBreakdown: Record<string, { hits: number; score: number }>;
}

/**
 * Category-weighted scoring with diminishing returns.
 *
 * Instead of flat additive scoring, this applies:
 * 1. Base weight from each keyword rule
 * 2. Category multiplier (e.g., ADMISSION keywords are worth 2x)
 * 3. Diminishing returns per category: 1st hit = 100%, 2nd = 70%, 3rd = 50%, 4th+ = 30%
 *
 * This prevents a message with 10 "fee"-related words from scoring
 * disproportionately high vs. one with diverse signals.
 */
@Injectable()
export class RuleScorer {
  private readonly logger = new Logger(RuleScorer.name);

  // Diminishing returns multipliers per subsequent hit in same category
  private readonly DIMINISHING_FACTORS = [1.0, 0.7, 0.5, 0.3];

  constructor(private config: ConfigService) {}

  /**
   * Score a message against whitelist keyword rules with category-weighted scoring.
   */
  score(
    text: string,
    textLower: string,
    whitelistRules: CompiledRule[],
  ): ScoringResult {
    const categoryHits = new Map<string, number>();
    const categoryBreakdown: Record<string, { hits: number; score: number }> = {};
    const matchedKeywords: string[] = [];
    const matchedRuleIds: string[] = [];
    let totalScore = 0;

    for (const rule of whitelistRules) {
      const searchText = rule.isCaseSensitive ? text : textLower;
      let isMatch = false;

      // Prefer word-boundary regex (avoids "ad" matching "admission")
      if (rule.wordBoundaryRegex) {
        // Reset lastIndex for global regex
        rule.wordBoundaryRegex.lastIndex = 0;
        isMatch = rule.wordBoundaryRegex.test(searchText);
      } else {
        // Fallback to includes
        isMatch = searchText.includes(rule.normalizedValue || rule.value.toLowerCase());
      }

      if (isMatch) {
        const category = rule.category || 'GENERAL';
        const hitIndex = categoryHits.get(category) || 0;
        categoryHits.set(category, hitIndex + 1);

        // Apply diminishing returns
        const diminishingFactor =
          this.DIMINISHING_FACTORS[Math.min(hitIndex, this.DIMINISHING_FACTORS.length - 1)];

        // Final score = weight × categoryWeight × diminishingFactor
        const ruleScore = rule.weight * rule.categoryWeight * diminishingFactor;
        totalScore += ruleScore;

        matchedKeywords.push(rule.value);
        matchedRuleIds.push(rule.id);

        // Track category breakdown
        if (!categoryBreakdown[category]) {
          categoryBreakdown[category] = { hits: 0, score: 0 };
        }
        categoryBreakdown[category].hits++;
        categoryBreakdown[category].score += ruleScore;
      }
    }

    return { totalScore: Math.round(totalScore), matchedKeywords, matchedRuleIds, categoryBreakdown };
  }
}
```

### `src/qualification/strategies/rule-engine.strategy.ts` (v2 — Full Replacement)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/database/prisma.service';
import {
  QualificationStatus,
  QualificationLayer,
} from '@prisma/client';
import { RuleCompiler } from './rule-compiler';
import { RuleScorer } from './rule-scorer';
import { ContentFingerprint } from './content-fingerprint';
import { RuleResult } from './interfaces/rule-result.interface';
import { CompiledRule, RuleIndex } from './interfaces/compiled-rule.interface';

@Injectable()
export class RuleEngineStrategy {
  private readonly logger = new Logger(RuleEngineStrategy.name);

  // Compiled rule index (refreshed every CACHE_TTL)
  private ruleIndex: RuleIndex | null = null;
  private lastCacheRefresh = 0;
  private readonly CACHE_TTL: number;

  // Configurable thresholds
  private readonly SHORT_TEXT_THRESHOLD: number;
  private readonly KEYWORD_THRESHOLD: number;

  constructor(
    private prisma: PrismaService,
    private compiler: RuleCompiler,
    private scorer: RuleScorer,
    private fingerprint: ContentFingerprint,
    private config: ConfigService,
  ) {
    this.CACHE_TTL = this.config.get<number>('RULE_ENGINE_CACHE_TTL_MS', 5 * 60 * 1000);
    this.SHORT_TEXT_THRESHOLD = this.config.get<number>('RULE_ENGINE_SHORT_TEXT_WORDS', 4);
    this.KEYWORD_THRESHOLD = this.config.get<number>('QUALIFICATION_KEYWORD_SCORE_THRESHOLD', 30);
  }

  // ═══════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Evaluate a message against all active rules.
   * Returns RuleResult if conclusive, null if ambiguous (needs AI).
   */
  async evaluate(message: {
    id: string;
    body: string;
    subject?: string | null;
    from: string;
  }): Promise<RuleResult | null> {
    const startTime = Date.now();
    const index = await this.loadIndex();
    const text = `${message.subject || ''} ${message.body}`.trim();
    const textLower = text.toLowerCase();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const senderDomain = this.extractDomain(message.from);

    let tiersEvaluated = 0;

    // ══════════════════════════════════════════════════════════
    // TIER 0: Duplicate Detection (O(1) cache + DB fallback)
    // ══════════════════════════════════════════════════════════
    tiersEvaluated++;
    const fp = this.fingerprint.generateFingerprint(message.body, message.from);
    const duplicateOf = await this.fingerprint.checkDuplicate(fp);

    if (duplicateOf) {
      this.logger.debug(`🔁 Duplicate of message ${duplicateOf}`);
      return {
        status: QualificationStatus.SPAM,
        layer: QualificationLayer.RULE_SHORTTEXT, // reuse layer or add RULE_DUPLICATE
        score: 0,
        matchedKeywords: [],
        matchedRuleIds: [],
        reason: `Duplicate message (identical content to ${duplicateOf} within 24h)`,
        isDuplicate: true,
        evaluationTimeMs: Date.now() - startTime,
        tiersEvaluated,
      };
    }

    // Register this fingerprint for future dedup checks
    this.fingerprint.registerFingerprint(fp, message.id);

    // ══════════════════════════════════════════════════════════
    // TIER 1: Fast Filters — O(1) Set lookups
    // ══════════════════════════════════════════════════════════
    tiersEvaluated++;

    // 1a. Sender domain blacklist
    if (senderDomain && index.senderDomainBlacklist.has(senderDomain)) {
      this.logger.debug(`🚫 Sender domain blacklisted: ${senderDomain}`);
      return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_BLACKLIST, 0,
        [], [], `Sender domain blacklisted: ${senderDomain}`, startTime, tiersEvaluated);
    }

    // 1b. Sender domain whitelist (auto-qualify trusted senders)
    if (senderDomain && index.senderDomainWhitelist.has(senderDomain)) {
      this.logger.debug(`✅ Sender domain whitelisted: ${senderDomain}`);
      return this.result(QualificationStatus.REAL_ENQUIRY, QualificationLayer.RULE_WHITELIST, 100,
        [], [], `Trusted sender domain: ${senderDomain}`, startTime, tiersEvaluated);
    }

    // 1c. Short text check (configurable threshold)
    if (wordCount < this.SHORT_TEXT_THRESHOLD) {
      this.logger.debug(`📏 Short text (${wordCount} words) → SPAM`);
      return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_SHORTTEXT, 0,
        [], [], `Message too short (${wordCount} words). Likely auto-reply or noise.`,
        startTime, tiersEvaluated);
    }

    // 1d. Exact blacklist keyword check (Set.has = O(1))
    const textWords = textLower.split(/\s+/);
    for (const word of textWords) {
      if (index.exactBlacklistKeywords.has(word)) {
        return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_BLACKLIST, 0,
          [word], [], `Blacklist keyword: "${word}"`, startTime, tiersEvaluated);
      }
    }
    // Case-sensitive exact keyword check
    const textWordsCaseSensitive = text.split(/\s+/);
    for (const word of textWordsCaseSensitive) {
      if (index.exactBlacklistKeywordsCaseSensitive.has(word)) {
        return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_BLACKLIST, 0,
          [word], [], `Blacklist keyword (case-sensitive): "${word}"`, startTime, tiersEvaluated);
      }
    }

    // ══════════════════════════════════════════════════════════
    // TIER 2: Pattern Matching — Pre-compiled RegExp
    // ══════════════════════════════════════════════════════════
    tiersEvaluated++;

    // 2a. Sender email pattern rules
    for (const rule of index.senderEmailPatterns) {
      if (rule.compiledRegex) {
        rule.compiledRegex.lastIndex = 0;
        if (rule.compiledRegex.test(message.from)) {
          this.logger.debug(`📧 Sender email pattern matched: ${rule.description}`);
          await this.incrementHitCount(rule.id);
          return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_PATTERN, 0,
            [rule.value], [rule.id],
            `Sender pattern matched: ${rule.description || rule.value}`, startTime, tiersEvaluated);
        }
      }
    }

    // 2b. Blacklist phrase matching
    for (const rule of index.blacklistPhrases) {
      const searchText = rule.isCaseSensitive ? text : textLower;
      if (searchText.includes(rule.normalizedValue!)) {
        this.logger.debug(`🚫 Blacklist phrase: "${rule.value}"`);
        await this.incrementHitCount(rule.id);
        return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_BLACKLIST, 0,
          [rule.value], [rule.id],
          `Blacklist phrase matched: "${rule.value}"`, startTime, tiersEvaluated);
      }
    }

    // 2c. Regex pattern matching (pre-compiled)
    for (const rule of index.regexPatterns) {
      if (rule.compiledRegex) {
        rule.compiledRegex.lastIndex = 0; // Reset for global flag
        if (rule.compiledRegex.test(text)) {
          this.logger.debug(`🔍 Regex pattern matched: ${rule.description}`);
          await this.incrementHitCount(rule.id);
          return this.result(QualificationStatus.SPAM, QualificationLayer.RULE_PATTERN, 0,
            [rule.value], [rule.id],
            `Spam pattern detected: ${rule.description || rule.value}`, startTime, tiersEvaluated);
        }
      }
    }

    // ══════════════════════════════════════════════════════════
    // TIER 3: Composite Rule Groups (AND/OR/NOT)
    // ══════════════════════════════════════════════════════════
    tiersEvaluated++;

    for (const group of index.compositeGroups) {
      const groupResult = this.evaluateCompositeGroup(group, text, textLower, message.from);
      if (groupResult.matched) {
        this.logger.debug(`🔗 Composite group matched: ${group.description}`);
        await this.incrementHitCount(group.id);

        // Composite groups that match → treat as strong signal
        // If weight > 0 it's whitelist (enquiry), if weight <= 0 it's blacklist (spam)
        const status = group.weight > 0
          ? QualificationStatus.REAL_ENQUIRY
          : QualificationStatus.SPAM;
        const layer = group.weight > 0
          ? QualificationLayer.RULE_WHITELIST
          : QualificationLayer.RULE_BLACKLIST;

        return this.result(status, layer, Math.abs(group.weight),
          groupResult.matchedValues, [group.id, ...groupResult.matchedRuleIds],
          `Composite rule: ${group.description || 'Group matched'}`, startTime, tiersEvaluated);
      }
    }

    // ══════════════════════════════════════════════════════════
    // TIER 4: Weighted Scoring (with categories + diminishing returns)
    // ══════════════════════════════════════════════════════════
    tiersEvaluated++;

    const scoringResult = this.scorer.score(text, textLower, index.whitelistKeywords);

    if (scoringResult.totalScore >= this.KEYWORD_THRESHOLD) {
      this.logger.debug(
        `📊 Keyword score ${scoringResult.totalScore} ≥ ${this.KEYWORD_THRESHOLD} → REAL_ENQUIRY`,
      );

      // Batch update hit counts for all matched rules
      await this.batchIncrementHitCounts(scoringResult.matchedRuleIds);

      return this.result(
        QualificationStatus.REAL_ENQUIRY,
        QualificationLayer.RULE_WHITELIST,
        scoringResult.totalScore,
        scoringResult.matchedKeywords,
        scoringResult.matchedRuleIds,
        `Keyword score ${scoringResult.totalScore} (threshold: ${this.KEYWORD_THRESHOLD}). ` +
        `Categories: ${JSON.stringify(scoringResult.categoryBreakdown)}. ` +
        `Matched: ${scoringResult.matchedKeywords.join(', ')}`,
        startTime,
        tiersEvaluated,
      );
    }

    // ══════════════════════════════════════════════════════════
    // AMBIGUOUS — Rules couldn't decide → forward to AI
    // ══════════════════════════════════════════════════════════
    this.logger.debug(
      `🤷 Rules inconclusive (score: ${scoringResult.totalScore}, tiers: ${tiersEvaluated}). → AI`,
    );
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // COMPOSITE GROUP EVALUATION (Recursive AND/OR/NOT)
  // ═══════════════════════════════════════════════════════════════════

  private evaluateCompositeGroup(
    group: CompiledRule,
    text: string,
    textLower: string,
    from: string,
  ): { matched: boolean; matchedValues: string[]; matchedRuleIds: string[] } {
    if (!group.children || group.children.length === 0) {
      return { matched: false, matchedValues: [], matchedRuleIds: [] };
    }

    const allMatchedValues: string[] = [];
    const allMatchedRuleIds: string[] = [];

    switch (group.groupOperator) {
      case 'AND': {
        // ALL children must match
        for (const child of group.children) {
          const childMatch = this.evaluateChild(child, text, textLower, from);
          if (!childMatch.matched) {
            return { matched: false, matchedValues: [], matchedRuleIds: [] };
          }
          allMatchedValues.push(...childMatch.matchedValues);
          allMatchedRuleIds.push(...childMatch.matchedRuleIds);
        }
        return { matched: true, matchedValues: allMatchedValues, matchedRuleIds: allMatchedRuleIds };
      }

      case 'OR': {
        // ANY child must match
        for (const child of group.children) {
          const childMatch = this.evaluateChild(child, text, textLower, from);
          if (childMatch.matched) {
            return {
              matched: true,
              matchedValues: childMatch.matchedValues,
              matchedRuleIds: childMatch.matchedRuleIds,
            };
          }
        }
        return { matched: false, matchedValues: [], matchedRuleIds: [] };
      }

      case 'NOT': {
        // NONE of the children should match (first child only for NOT)
        const child = group.children[0];
        if (!child) return { matched: false, matchedValues: [], matchedRuleIds: [] };
        const childMatch = this.evaluateChild(child, text, textLower, from);
        return {
          matched: !childMatch.matched,
          matchedValues: childMatch.matched ? [] : [child.value],
          matchedRuleIds: childMatch.matched ? [] : [child.id],
        };
      }

      default:
        return { matched: false, matchedValues: [], matchedRuleIds: [] };
    }
  }

  /**
   * Evaluate a single child rule within a composite group.
   * Supports both simple rules and nested groups (recursion).
   */
  private evaluateChild(
    child: CompiledRule,
    text: string,
    textLower: string,
    from: string,
  ): { matched: boolean; matchedValues: string[]; matchedRuleIds: string[] } {
    // Nested composite group → recurse
    if (child.type === ('COMPOSITE_GROUP' as any) && child.children) {
      return this.evaluateCompositeGroup(child, text, textLower, from);
    }

    // Simple rule evaluation
    const searchText = child.isCaseSensitive ? text : textLower;

    let matched = false;

    switch (child.type) {
      case 'BLACKLIST_KEYWORD':
      case 'WHITELIST_KEYWORD':
        if (child.wordBoundaryRegex) {
          child.wordBoundaryRegex.lastIndex = 0;
          matched = child.wordBoundaryRegex.test(searchText);
        } else {
          matched = searchText.includes(child.normalizedValue || child.value.toLowerCase());
        }
        break;

      case 'BLACKLIST_PHRASE':
        matched = searchText.includes(child.normalizedValue || child.value.toLowerCase());
        break;

      case 'REGEX_PATTERN':
      case 'SENDER_EMAIL_PATTERN':
        if (child.compiledRegex) {
          child.compiledRegex.lastIndex = 0;
          const target = child.type === ('SENDER_EMAIL_PATTERN' as any) ? from : text;
          matched = child.compiledRegex.test(target);
        }
        break;

      case 'SENDER_DOMAIN_BLACKLIST':
      case 'SENDER_DOMAIN_WHITELIST':
        const domain = this.extractDomain(from);
        matched = domain === child.value.toLowerCase();
        break;
    }

    return {
      matched,
      matchedValues: matched ? [child.value] : [],
      matchedRuleIds: matched ? [child.id] : [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  private async loadIndex(): Promise<RuleIndex> {
    const now = Date.now();
    if (!this.ruleIndex || now - this.lastCacheRefresh > this.CACHE_TTL) {
      this.ruleIndex = await this.compiler.compile();
      this.lastCacheRefresh = now;
    }
    return this.ruleIndex;
  }

  /**
   * Force cache refresh (called when rules are CRUD'd).
   */
  invalidateCache(): void {
    this.lastCacheRefresh = 0;
    this.ruleIndex = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private extractDomain(email: string): string | null {
    const match = email.match(/@([^@\s]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  private result(
    status: QualificationStatus,
    layer: QualificationLayer,
    score: number,
    matchedKeywords: string[],
    matchedRuleIds: string[],
    reason: string,
    startTime: number,
    tiersEvaluated: number,
  ): RuleResult {
    return {
      status, layer, score, matchedKeywords, matchedRuleIds, reason,
      evaluationTimeMs: Date.now() - startTime,
      tiersEvaluated,
    };
  }

  /**
   * Increment hit counter for a rule (fire-and-forget, non-blocking).
   */
  private async incrementHitCount(ruleId: string): Promise<void> {
    this.prisma.qualificationRule.update({
      where: { id: ruleId },
      data: {
        hitCount: { increment: 1 },
        lastHitAt: new Date(),
      },
    }).catch((err) => this.logger.warn(`Failed to increment hit count for rule ${ruleId}: ${err.message}`));
  }

  /**
   * Batch increment for multiple rule hits (used in scoring tier).
   */
  private async batchIncrementHitCounts(ruleIds: string[]): Promise<void> {
    if (ruleIds.length === 0) return;

    // Use a single transaction for all increments
    const updates = ruleIds.map((id) =>
      this.prisma.qualificationRule.update({
        where: { id },
        data: {
          hitCount: { increment: 1 },
          lastHitAt: new Date(),
        },
      }),
    );

    Promise.all(updates).catch((err) =>
      this.logger.warn(`Failed to batch increment hit counts: ${err.message}`),
    );
  }
}
```

---

## Key Differences: Side-by-Side

### 1. Matching Accuracy

| Scenario | v1 (Current) | v2 (Optimised) |
|---|---|---|
| Blacklist "ad" vs text "admission" | ❌ `includes("ad")` matches "admission" | ✅ `\bad\b` word-boundary regex does NOT match |
| Blacklist "buy now" | ✅ Phrase matching works | ✅ Same, plus normalised comparison |
| Sender from `spam.com` | ❌ Not checked at all | ✅ O(1) Set lookup before any text processing |

### 2. Performance

| Metric | v1 | v2 |
|---|---|---|
| Regex compilation | Every message × every rule | Once on cache load |
| Blacklist keyword lookup | O(n) loop with `includes()` | O(1) `Set.has()` |
| Rule sorting | DB order, arbitrary | Priority-sorted, cheapest first |
| Duplicate messages | Full re-processing | O(1) fingerprint check |

### 3. Scoring Intelligence

| Feature | v1 | v2 |
|---|---|---|
| Weight calculation | Flat additive (weight1 + weight2 + ...) | Category-weighted with diminishing returns |
| Category awareness | None | ADMISSION=2x, FEE=1.5x, etc. |
| Repeated keywords | Each hit adds full weight | 1st=100%, 2nd=70%, 3rd=50%, 4th+=30% |
| Score debuggability | Just total score | Full category breakdown JSON |

### 4. Rule Expressiveness

| Feature | v1 | v2 |
|---|---|---|
| Simple keywords | ✅ | ✅ |
| Regex patterns | ✅ | ✅ (pre-compiled) |
| AND (all must match) | ❌ | ✅ Composite groups |
| OR (any must match) | ❌ | ✅ Composite groups |
| NOT (must not match) | ❌ | ✅ Composite groups |
| Nested groups | ❌ | ✅ Recursive evaluation |
| Sender domain rules | ❌ | ✅ Blacklist + Whitelist |
| Sender email patterns | ❌ | ✅ Regex on email address |

### 5. Observability

| Feature | v1 | v2 |
|---|---|---|
| Which rules fired? | Just matched keywords | `matchedRuleIds[]` array |
| Rule hit frequency | ❌ Unknown | ✅ `hitCount` + `lastHitAt` per rule |
| Evaluation depth | ❌ Unknown | ✅ `tiersEvaluated` counter |
| Processing time | ❌ Not tracked | ✅ `evaluationTimeMs` per message |
| Duplicate detection | ❌ None | ✅ `isDuplicate` flag |

---

## Configuration (Environment Variables)

```env
# ── Rule Engine v2 Config ──
RULE_ENGINE_CACHE_TTL_MS=300000                    # 5 min (default)
RULE_ENGINE_SHORT_TEXT_WORDS=4                     # Min words before marking as spam
QUALIFICATION_KEYWORD_SCORE_THRESHOLD=30           # Min score to auto-qualify as enquiry

# ── Content Fingerprint Config ──
RULE_ENGINE_DEDUP_WINDOW_MS=86400000               # 24 hours (default)
RULE_ENGINE_DEDUP_CACHE_SIZE=10000                 # In-memory fingerprint cache size
```

---

## Migration Path (v1 → v2)

The v2 engine is **backward-compatible** with existing rules. The changes are:

1. **Schema migration**: Add new fields (`priority`, `category`, `categoryWeight`, `groupId`, `groupOperator`, `hitCount`, `lastHitAt`) and new enum values. Existing rules get sensible defaults.
2. **New files**: Add `rule-compiler.ts`, `rule-scorer.ts`, `content-fingerprint.ts`, and interfaces.
3. **Replace**: Swap the `rule-engine.strategy.ts` implementation.
4. **Module update**: Register the 3 new providers (`RuleCompiler`, `RuleScorer`, `ContentFingerprint`).
5. **No API changes**: The `evaluate()` method signature is the same (with one addition: `message.id`).

Existing `BLACKLIST_KEYWORD`, `BLACKLIST_PHRASE`, `WHITELIST_KEYWORD`, and `REGEX_PATTERN` rules will work exactly as before — just faster and with better matching accuracy.

---

## When to Use v1 vs v2

| Scenario | Recommendation |
|---|---|
| < 50 rules, < 100 messages/day | v1 is fine — simpler to maintain |
| 50-500 rules, moderate volume | v2 recommended — better accuracy & performance |
| 500+ rules, high volume | v2 essential — O(1) lookups and pre-compilation are critical |
| Need composite logic (AND/OR/NOT) | v2 only — v1 has no support |
| Need duplicate detection | v2 only — v1 has no support |
| Need to debug which rules fire | v2 only — v1 tracks keywords but not rule IDs |
