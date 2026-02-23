# 🏗️ Part 1: Schema & Foundation — The Data Model

> **The entire system is built on this schema.** Every module in Parts 2-8 reads from and writes to these models. Understand this first, everything else follows.

---

## Architecture Overview (v2)

```
WhatsApp/Email Webhook
        ↓
  WebhookController (parses raw payload)
        ↓
  IngestionService.ingest()
        ↓
  ┌─ NEW: ContactService.resolve() ─┐
  │  Find or create Contact from     │
  │  phone/email. Link the channel.  │
  └──────────────────────────────────┘
        ↓
  InboundMessage saved (status: PENDING, contactId: xxx)
        ↓
  Job queued → BullMQ 'qualification' queue
        ↓
  QualificationProcessor picks up job
        ↓
  QualificationService.qualify()
        ↓
  Layer 1: RuleEngineStrategy.evaluate() (v2 — pre-compiled, tiered)
    ├─ Tier 0: Duplicate fingerprint check
    ├─ Tier 1: Domain blacklist/whitelist (O(1) Set)
    ├─ Tier 2: Pre-compiled regex + phrases
    ├─ Tier 3: Composite rule groups (AND/OR/NOT)
    ├─ Tier 4: Category-weighted scoring
    └─ Ambiguous → Layer 2
        ↓
  Layer 2: AIClassifierStrategy.classify()
    ├─ High confidence → REAL_ENQUIRY or SPAM
    └─ Low confidence → NEEDS_REVIEW
        ↓
  If REAL_ENQUIRY → EventEmitter 'enquiry.qualified'
        ↓
  ┌─ NEW: EnquiryService.handleQualified() ──────────────────┐
  │  1. Get contactId from InboundMessage                     │
  │  2. Check: does this Contact have an OPEN enquiry?        │
  │     YES → Append message to existing enquiry              │
  │     NO  → Create NEW enquiry (linked to Contact)          │
  │  3. Auto-assign (round-robin)                             │
  │  4. Start SLA timer                                       │
  └───────────────────────────────────────────────────────────┘
        ↓
  Staff sees enquiry in inbox → replies
        ↓
  ┌─ NEW: OutboundService.send() ────────────────────────────┐
  │  1. Pick channel (auto: last used by customer, or manual) │
  │  2. Call ChannelAdapter (WhatsApp API / SendGrid / SMTP)  │
  │  3. Track delivery (SENT → DELIVERED → READ)              │
  └───────────────────────────────────────────────────────────┘
```

---

## Step 1: Install Dependencies

```bash
npm install @anthropic-ai/sdk @nestjs/bullmq @nestjs/event-emitter @nestjs/schedule
```

> `@nestjs/schedule` is new — used for SLA checks and stale enquiry detection (cron jobs).

---

## Step 2: Environment Variables

Add to `.env`:

```env
# ── Existing ──
DATABASE_URL="postgresql://eventops:eventops@localhost:5432/eventops_db"
JWT_SECRET=your-jwt-secret-here
FRONTEND_URL=http://localhost:3000

# ── AI Qualification ──
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx
QUALIFICATION_BUSINESS_CONTEXT="a product-based company handling purchase inquiries, pricing requests, and customer communications"
QUALIFICATION_AI_CONFIDENCE_THRESHOLD=65
QUALIFICATION_KEYWORD_SCORE_THRESHOLD=30

# ── Redis (BullMQ) ──
REDIS_HOST=localhost
REDIS_PORT=6379

# ── Rule Engine v2 ──
RULE_ENGINE_CACHE_TTL_MS=300000
RULE_ENGINE_SHORT_TEXT_WORDS=4

# ── Outbound Messaging ──
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_ACCESS_TOKEN=your-access-token
SENDGRID_API_KEY=SG.xxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@yourcompany.com
SENDGRID_FROM_NAME=Your Company Name

# ── SLA Configuration ──
SLA_FIRST_RESPONSE_MINUTES=30
SLA_RESOLUTION_HOURS=48
SLA_STALE_DAYS=7
SLA_AUTO_CLOSE_DAYS=14

# ── Auto-Assignment ──
AUTO_ASSIGN_ENABLED=true
AUTO_ASSIGN_STRATEGY=round_robin
```

---

## Step 3: Complete Prisma Schema

> **This replaces your entire `prisma/schema.prisma`.** Every model is commented with WHY it exists and HOW it relates to the system.

```prisma
// prisma/schema.prisma
// Enterprise Enquiry System v2 — Complete production schema
// 
// DATA MODEL OVERVIEW:
//   Contact (person) → ContactChannel[] (their phone/email/etc)
//   Contact → Enquiry[] (their conversations with us)
//   Enquiry → ConversationMessage[] (the actual messages)
//   InboundMessage (raw staging) → QualificationResult (AI/rule decision)
//
// KEY CHANGE FROM v1:
//   Before: InboundMessage (1:1) → Enquiry (every message = new enquiry)
//   After:  Contact (1:N) → Enquiry (one person can have ongoing conversations)

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
}

// ============================================================================
// USERS & PERMISSIONS
// ============================================================================

model Permission {
  id      String @id @default(uuid())
  action  String // "create", "read", "update", "delete", "manage"
  subject String // "enquiry", "inboundMessage", "qualificationRule", etc

  rolePermissions RolePermission[]

  @@unique([action, subject])
}

model RolePermission {
  id           String     @id @default(uuid())
  role         UserRole
  permissionId String
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  conditions   Json?
  createdAt    DateTime   @default(now())

  @@unique([role, permissionId])
  @@index([role])
}

model User {
  id          String    @id @default(uuid())
  userName    String    @unique @map("UserName")
  email       String?   @unique
  displayName String?
  password    String
  role        UserRole
  isActive    Boolean   @default(true)
  lastLoginAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  assignedEnquiries Enquiry[]          @relation("EnquiryAssignment")
  sentMessages      ConversationMessage[] @relation("MessageSender")
}

enum UserRole {
  ADMIN
  MANAGER
  SALES
  OPS
}

// ============================================================================
// CONTACTS — The unified identity layer
// WHY: A "Contact" is a PERSON, not a phone number. The same person might
//      message from WhatsApp (+91-9876...) and Email (rahul@gmail.com).
//      Both should link to ONE Contact record.
// ============================================================================

model Contact {
  id          String   @id @default(uuid())
  displayName String   @default("Unknown")  // Updated when AI extracts name or staff edits
  
  // Optional profile info (enriched over time)
  organization String? // Company/org name if known
  notes        String? // Staff can add notes about this person
  
  // Tracking
  firstSeenAt DateTime @default(now()) // When we first heard from them
  lastSeenAt  DateTime @default(now()) // Updated on every new message
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Relations
  channels        ContactChannel[]    // All known phone/email/etc
  enquiries       Enquiry[]           // All conversations with this person
  inboundMessages InboundMessage[]    // All raw messages from this person
  
  @@index([displayName])
  @@index([lastSeenAt])
}

// One Contact can have multiple channels (WhatsApp, Email, etc)
// This is how we know "+91-9876..." and "rahul@gmail.com" are the SAME person
model ContactChannel {
  id         String         @id @default(uuid())
  contactId  String
  contact    Contact        @relation(fields: [contactId], references: [id], onDelete: Cascade)
  
  channel    MessageChannel // WHATSAPP, EMAIL, SMS
  identifier String         // The actual phone number or email address
  
  isPrimary  Boolean @default(false)  // Preferred channel for outbound
  isVerified Boolean @default(false)  // Manually verified by staff
  
  createdAt DateTime @default(now())
  
  // A channel+identifier combination must be unique
  // (only one Contact can own "+91-9876543210" on WhatsApp)
  @@unique([channel, identifier])
  @@index([contactId])
}

// ============================================================================
// INBOUND MESSAGES — Raw staging area (before qualification)
// WHY: Every incoming message lands here FIRST, before any processing.
//      This is the "raw data" — never modified after creation.
//      The qualification pipeline reads from here and writes results.
// ============================================================================

enum MessageChannel {
  EMAIL
  WHATSAPP
  SMS
}

enum QualificationStatus {
  PENDING           // Just arrived, not qualified yet
  PROCESSING        // Currently being qualified
  REAL_ENQUIRY      // Confirmed real lead
  SPAM              // Confirmed junk
  NEEDS_REVIEW      // AI unsure — human must decide
  REVIEWED_APPROVED // Human approved after review
  REVIEWED_REJECTED // Human rejected after review
}

model InboundMessage {
  id String @id @default(uuid())

  // Source info
  channel    MessageChannel
  externalId String? // WhatsApp message ID, email Message-ID, etc
  from       String  // Phone number or email
  to         String? // Your receiving number/email

  // Content
  subject String? // Email subject (strong qualifying signal)
  body    String  // The actual message text

  // Metadata
  rawPayload         Json?    // Full webhook payload for debugging
  contentFingerprint String?  // SHA-256 hash for duplicate detection (Rule Engine v2)
  receivedAt         DateTime @default(now())

  // Qualification state
  status QualificationStatus @default(PENDING)

  // ── NEW: Link to Contact (resolved during ingestion) ──
  contactId String?
  contact   Contact? @relation(fields: [contactId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  qualificationResult QualificationResult?

  @@unique([channel, externalId])
  @@index([status, receivedAt])
  @@index([status])
  @@index([channel])
  @@index([receivedAt])
  @@index([contactId])
  @@index([contentFingerprint])
}

// ============================================================================
// QUALIFICATION SYSTEM
// WHY: Determines if an inbound message is a real enquiry or spam.
//      3-layer pipeline: Rule Engine → AI Classifier → Manual Review
// ============================================================================

// What type of rule is this — determines how the Rule Engine processes it
enum RuleType {
  BLACKLIST_KEYWORD         // Single word that triggers SPAM
  BLACKLIST_PHRASE          // Multi-word phrase that triggers SPAM
  WHITELIST_KEYWORD         // Positive signal word (scored)
  REGEX_PATTERN             // Regex pattern to match (usually spam)
  SENDER_DOMAIN_BLACKLIST   // Block entire domains (e.g., "spam.com")
  SENDER_DOMAIN_WHITELIST   // Auto-approve trusted domains
  SENDER_EMAIL_PATTERN      // Regex on sender email
  COMPOSITE_GROUP           // Container for AND/OR/NOT logic
}

// Which layer made the final decision — for analytics and debugging
enum QualificationLayer {
  RULE_BLACKLIST   // Killed by blacklist keyword/phrase
  RULE_SHORTTEXT   // Too short (< N words, configurable)
  RULE_PATTERN     // Spam regex pattern matched
  RULE_WHITELIST   // High keyword score → real enquiry
  RULE_DUPLICATE   // Duplicate content fingerprint detected
  RULE_DOMAIN      // Sender domain blacklist/whitelist
  AI_CLASSIFIER    // AI made the decision
  MANUAL_OVERRIDE  // Human overrode AI/rule decision
}

// What the enquirer's intent is — classified by AI
enum EnquiryIntent {
  PRODUCT_INQUIRY    // Asking about a product or service
  PRICING_REQUEST    // Asking for pricing/quote
  BULK_ORDER         // Bulk purchase inquiry
  SHIPPING_INQUIRY   // Asking about delivery/shipping
  GENERAL_INFO       // General information request
  COMPLAINT          // Complaint or issue
  APPOINTMENT        // Requesting meeting/demo
  DOCUMENT_SUBMIT    // Sending documents (PO, invoice, etc.)
  RETURN_REFUND      // Return or refund request
  PARTNERSHIP        // Partnership/collaboration
  UNKNOWN            // AI couldn't determine
}

// Logical operator for composite rule groups
enum RuleGroupOperator {
  AND  // ALL child rules must match
  OR   // ANY child rule must match
  NOT  // Child rule must NOT match
}

// Admin-editable qualification rules
model QualificationRule {
  id              String   @id @default(uuid())
  type            RuleType
  value           String   // The keyword, phrase, regex, or domain
  weight          Int      @default(10)  // Score weight (for WHITELIST_KEYWORD)
  description     String?  // Human-readable explanation of why this rule exists
  isActive        Boolean  @default(true)
  isCaseSensitive Boolean  @default(false)
  createdBy       String?  // userId of who created this rule
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Rule Engine v2: execution ordering and scoring
  priority       Int    @default(100)  // Lower number = runs first
  category       String?              // e.g., "PRODUCT", "PRICING", "SHIPPING"
  categoryWeight Float  @default(1.0) // Multiplier: PRODUCT=2.0, PRICING=1.5, etc

  // Composite group support (AND/OR/NOT)
  groupId       String?             // Parent group ID (null = top-level rule)
  groupOperator RuleGroupOperator?  // Only set when type = COMPOSITE_GROUP
  parentGroup   QualificationRule?  @relation("RuleGroup", fields: [groupId], references: [id])
  childRules    QualificationRule[] @relation("RuleGroup")

  // Analytics: track which rules are actually useful
  hitCount  Int       @default(0)  // How many times this rule matched
  lastHitAt DateTime?              // When it last matched

  @@index([type, isActive])
  @@index([isActive, priority])
}

// Complete audit trail of every qualification decision
model QualificationResult {
  id String @id @default(uuid())

  // Link to the raw inbound message
  inboundMessageId String         @unique
  inboundMessage   InboundMessage @relation(fields: [inboundMessageId], references: [id], onDelete: Cascade)

  // Final decision
  finalStatus QualificationStatus
  finalLayer  QualificationLayer

  // Rule engine output
  ruleScore       Int      @default(0)
  matchedKeywords String[] @default([])
  matchedRuleIds  String[] @default([]) // NEW: track exact rule IDs that fired
  ruleReason      String?

  // AI output
  sentToAI         Boolean @default(false)
  aiConfidence     Int?    // 0-100
  aiReason         String?
  intent           EnquiryIntent?
  urgency          Int?    // 1-5
  priority         Int?    // 1-10
  extractedData    Json?   // { contactName, budgetSignal, quantitySignal, etc }
  detectedLanguage String? // 'en', 'hi', 'ar', etc

  // Cost tracking
  aiInputTokens    Int?
  aiOutputTokens   Int?
  estimatedCostUsd Decimal? @db.Decimal(10, 6)
  processingTimeMs Int

  // Manual override tracking
  wasOverridden  Boolean              @default(false)
  overriddenTo   QualificationStatus?
  overriddenBy   String?
  overrideReason String?
  overriddenAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([finalStatus, createdAt])
  @@index([finalLayer])
  @@index([intent])
  @@index([sentToAI])
  @@index([createdAt])
}

// ============================================================================
// ENQUIRIES — Conversations with qualified contacts
// WHY: An Enquiry is a CONVERSATION THREAD, not a single message.
//      One Contact can have one open Enquiry at a time.
//      When the same person sends another message, it APPENDS to the open Enquiry.
//      New Enquiry only created if previous is CONVERTED or CLOSED_LOST.
// ============================================================================

enum EnquiryType {
  REAL   // Confirmed real lead → main sales inbox
  REVIEW // Needs human review → review inbox
  SPAM   // Marked as spam → hidden from main view
}

enum EnquiryStatus {
  NEW               // Just created, no one has looked at it
  OPEN              // Assigned or being looked at
  IN_PROGRESS       // Staff is actively working on it
  AWAITING_CUSTOMER // Staff replied, waiting for customer to respond
  QUOTATION_SENT    // Quote/fee structure sent
  FOLLOW_UP         // Needs follow-up (scheduled)
  STALE             // No activity for configured days
  CONVERTED         // Deal won / purchase confirmed
  CLOSED_LOST       // Deal lost / not interested
}

model Enquiry {
  id String @id @default(uuid())

  // Inbox type
  type EnquiryType @default(REAL)

  // ── NEW: Link to Contact (REPLACES direct phone/email) ──
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id])

  // State
  status     EnquiryStatus @default(NEW)
  tags       String[]      @default([])
  lostReason String?

  // Intent & priority (from qualification or AI)
  intent   EnquiryIntent?
  urgency  Int?   // 1-5
  priority Int?   // 1-10

  // Tracking
  version             Int       @default(1)   // Optimistic concurrency
  lastCustomerReplyAt DateTime?               // When customer last messaged
  firstResponseAt     DateTime?               // When staff first replied
  lastActivityAt      DateTime  @default(now()) // Any activity (message, status change)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Assignment
  assignedToId String?
  assignedTo   User?   @relation("EnquiryAssignment", fields: [assignedToId], references: [id])

  // Relations
  timeline EnquiryTimeline[]
  messages ConversationMessage[]
  notes    InternalNote[]

  @@index([contactId, status]) // Core query: "open enquiry for this contact?"
  @@index([type, status])
  @@index([status])
  @@index([assignedToId])
  @@index([createdAt])
  @@index([intent])
  @@index([priority])
  @@index([lastActivityAt])
}

// ============================================================================
// CONVERSATION MESSAGES — The actual chat messages within an enquiry
// WHY: This is the unified conversation thread. Messages from ALL channels
//      (WhatsApp, Email, SMS) are stored here, sorted by createdAt.
//      The UI shows them as a continuous chat with channel badges.
// ============================================================================

enum MessageDirection {
  INBOUND  // From customer
  OUTBOUND // From your team
}

enum DeliveryStatus {
  PENDING   // Not yet sent to provider
  SENT      // Sent to provider (WhatsApp/Email API accepted)
  DELIVERED // Delivered to recipient
  READ      // Read by recipient (WhatsApp blue ticks)
  FAILED    // Delivery failed
}

model ConversationMessage {
  id        String           @id @default(uuid())
  enquiryId String
  enquiry   Enquiry          @relation(fields: [enquiryId], references: [id], onDelete: Cascade)

  channel   MessageChannel   // Which channel this msg was sent/received on
  direction MessageDirection // INBOUND or OUTBOUND

  from    String    // Sender (phone/email for inbound, userId for outbound)
  to      String?   // Recipient
  subject String?   // Email subject
  content String    // The message text

  // Outbound tracking
  externalId     String?        // Provider's message ID (wamid_xxx, Message-ID, etc)
  deliveryStatus DeliveryStatus @default(PENDING) // Tracks delivery
  deliveredAt    DateTime?      // When delivered
  readAt         DateTime?      // When read

  // Who sent it (for outbound messages)
  sentByUserId String?
  sentByUser   User?   @relation("MessageSender", fields: [sentByUserId], references: [id])

  createdAt DateTime @default(now())

  @@index([enquiryId, createdAt])
  @@index([externalId])
  @@index([createdAt])
}

// ============================================================================
// INTERNAL NOTES — Private staff notes (NOT sent to customer)
// WHY: Staff needs to communicate internally about an enquiry.
//      These notes are NEVER visible to the customer.
//      Shown in the enquiry timeline with a special "note" badge.
// ============================================================================

model InternalNote {
  id        String  @id @default(uuid())
  enquiryId String
  enquiry   Enquiry @relation(fields: [enquiryId], references: [id], onDelete: Cascade)

  content   String  // The note text
  createdBy String  // userId who wrote the note

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([enquiryId, createdAt])
}


// ============================================================================
// ENQUIRY TIMELINE — Complete audit trail of everything that happens
// WHY: Legal compliance, debugging, and staff accountability.
//      Every action on an enquiry is recorded here permanently.
// ============================================================================

enum EnquiryEventType {
  CREATED
  STATUS_CHANGED
  ASSIGNED
  REASSIGNED
  FOLLOWUP_SENT
  FOLLOWUP_SCHEDULED
  CUSTOMER_REPLIED
  MESSAGE_SENT
  MESSAGE_RECEIVED
  TAG_ADDED
  TAG_REMOVED
  NOTE_ADDED
  CONVERTED
  CLOSED
  REOPENED
  CONTACT_MERGED          // When another contact was merged into this enquiry's contact
  AUTO_ASSIGNED
  STALE_DETECTED
}

model EnquiryTimeline {
  id        String           @id @default(uuid())
  enquiryId String
  type      EnquiryEventType

  fromStatus EnquiryStatus?
  toStatus   EnquiryStatus?

  metadata  Json?    // Flexible: { tag, reason, previousAssignee, channelUsed, etc }
  createdBy String?  // userId or "SYSTEM"
  createdAt DateTime @default(now())

  enquiry Enquiry @relation(fields: [enquiryId], references: [id], onDelete: Cascade)

  @@index([enquiryId, createdAt])
  @@index([type])
  @@index([createdAt])
}


// ============================================================================
// IDEMPOTENCY — Prevents duplicate webhook processing
// ============================================================================

model IdempotencyKey {
  id          String   @id @default(uuid())
  key         String   @unique
  requestHash String
  response    Json?
  status      String // PROCESSING | COMPLETED
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([createdAt])
  @@index([status])
}
```

---

## Step 4: Updated CASL Types

Add new subjects for the v2 system:

```typescript
// src/modules/casl/casl.types.ts

import { AbilityClass, PureAbility } from '@casl/ability';
import { PrismaQuery } from '@casl/prisma';

export type Actions =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'assign'
  | 'merge'   // NEW: for contact merging
  | 'manage';

export type AppSubjects =
  | 'Enquiry'
  | 'Message'
  | 'User'
  | 'Permission'
  | 'Dashboard'
  | 'Contact'              // NEW
  | 'InboundMessage'
  | 'QualificationRule'
  | 'QualificationResult'
  | 'InternalNote'         // NEW
  | 'CannedResponse'       // NEW
  | 'SlaConfig'            // NEW
  | 'all';

export type AppAbility = PureAbility<[Actions, AppSubjects], PrismaQuery>;

export const AppAbility = PureAbility as AbilityClass<AppAbility>;
```

---

## Step 5: Seed File (Generic Product Company Rules)

```typescript
// prisma/seed.ts
// Seeds qualification rules for a product-based company

import 'dotenv/config';
import { PrismaClient, RuleType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding qualification rules for enquiry system...');

  // ══════════════════════════════════════════════
  // BLACKLIST KEYWORDS — spam indicators
  // ══════════════════════════════════════════════
  const blacklistKeywords = [
    { value: 'unsubscribe', description: 'Email unsubscribe link text' },
    { value: 'click here', description: 'Spam CTA pattern' },
    { value: 'you have won', description: 'Lottery/prize scam' },
    { value: 'act now', description: 'Urgency scam pattern' },
    { value: 'limited time offer', description: 'Spam urgency pattern' },
    { value: 'free gift', description: 'Spam bait pattern' },
    { value: 'congratulations', description: 'Prize scam opener' },
    { value: 'no obligation', description: 'Spam sales pattern' },
    { value: 'risk free', description: 'Spam guarantee pattern' },
    { value: 'double your', description: 'Financial scam pattern' },
    { value: 'work from home', description: 'MLM/scam pattern' },
    { value: 'earn money', description: 'Financial scam' },
  ];

  // ══════════════════════════════════════════════
  // BLACKLIST PHRASES — exact match spam
  // ══════════════════════════════════════════════
  const blacklistPhrases = [
    { value: 'this is not spam', description: 'Ironic spam self-declaration' },
    { value: 'dear sir/madam', description: 'Generic spam greeting' },
    { value: 'nigerian prince', description: 'Classic scam pattern' },
    { value: 'wire transfer', description: 'Financial scam indicator' },
    { value: 'your account has been', description: 'Phishing pattern' },
  ];

  // ══════════════════════════════════════════════
  // WHITELIST KEYWORDS — product enquiry signals
  // Categorised for weighted scoring
  // ══════════════════════════════════════════════
  const whitelistKeywords = [
    // PRODUCT category (2x weight multiplier)
    { value: 'product', weight: 20, category: 'PRODUCT', categoryWeight: 2.0, description: 'Product inquiry' },
    { value: 'products', weight: 20, category: 'PRODUCT', categoryWeight: 2.0, description: 'Product inquiry (plural)' },
    { value: 'catalog', weight: 20, category: 'PRODUCT', categoryWeight: 2.0, description: 'Catalog request' },
    { value: 'catalogue', weight: 20, category: 'PRODUCT', categoryWeight: 2.0, description: 'Catalogue request (British)' },
    { value: 'specification', weight: 15, category: 'PRODUCT', categoryWeight: 2.0, description: 'Spec sheet request' },
    { value: 'availability', weight: 25, category: 'PRODUCT', categoryWeight: 2.0, description: 'Stock/availability check' },
    { value: 'in stock', weight: 25, category: 'PRODUCT', categoryWeight: 2.0, description: 'Strong purchase signal' },
    { value: 'place order', weight: 30, category: 'PRODUCT', categoryWeight: 2.0, description: 'Very strong purchase signal' },
    { value: 'purchase', weight: 20, category: 'PRODUCT', categoryWeight: 2.0, description: 'Purchase intent' },

    // PRICING category (1.5x weight)
    { value: 'price', weight: 15, category: 'PRICING', categoryWeight: 1.5, description: 'Price inquiry' },
    { value: 'pricing', weight: 15, category: 'PRICING', categoryWeight: 1.5, description: 'Pricing inquiry' },
    { value: 'price list', weight: 25, category: 'PRICING', categoryWeight: 1.5, description: 'Strong pricing signal' },
    { value: 'quotation', weight: 20, category: 'PRICING', categoryWeight: 1.5, description: 'Quote request' },
    { value: 'quote', weight: 20, category: 'PRICING', categoryWeight: 1.5, description: 'Quote request' },
    { value: 'discount', weight: 15, category: 'PRICING', categoryWeight: 1.5, description: 'Discount inquiry' },
    { value: 'payment', weight: 10, category: 'PRICING', categoryWeight: 1.5, description: 'Payment related' },
    { value: 'installment', weight: 15, category: 'PRICING', categoryWeight: 1.5, description: 'Payment plan inquiry' },
    { value: 'bulk pricing', weight: 25, category: 'PRICING', categoryWeight: 1.5, description: 'Bulk pricing signal' },

    // SHIPPING category (1.0x weight)
    { value: 'shipping', weight: 15, category: 'SHIPPING', categoryWeight: 1.0, description: 'Shipping inquiry' },
    { value: 'delivery', weight: 15, category: 'SHIPPING', categoryWeight: 1.0, description: 'Delivery inquiry' },
    { value: 'shipping cost', weight: 20, category: 'SHIPPING', categoryWeight: 1.0, description: 'Shipping cost inquiry' },
    { value: 'delivery time', weight: 20, category: 'SHIPPING', categoryWeight: 1.0, description: 'Delivery timeline inquiry' },
    { value: 'tracking', weight: 10, category: 'SHIPPING', categoryWeight: 1.0, description: 'Order tracking inquiry' },
    { value: 'return', weight: 15, category: 'SHIPPING', categoryWeight: 1.0, description: 'Return/refund inquiry' },

    // GENERAL category (1.0x weight)
    { value: 'warranty', weight: 15, category: 'GENERAL', categoryWeight: 1.0, description: 'Warranty inquiry' },
    { value: 'demo', weight: 20, category: 'GENERAL', categoryWeight: 1.0, description: 'Demo request — strong signal' },
    { value: 'sample', weight: 20, category: 'GENERAL', categoryWeight: 1.0, description: 'Sample request — strong signal' },
    { value: 'brochure', weight: 20, category: 'GENERAL', categoryWeight: 1.0, description: 'Brochure request — strong signal' },
    { value: 'appointment', weight: 15, category: 'GENERAL', categoryWeight: 1.0, description: 'Meeting request signal' },
    { value: 'interested', weight: 15, category: 'GENERAL', categoryWeight: 1.0, description: 'General interest signal' },
    { value: 'information', weight: 10, category: 'GENERAL', categoryWeight: 1.0, description: 'Information request' },
    { value: 'bulk order', weight: 25, category: 'GENERAL', categoryWeight: 1.0, description: 'Bulk order signal' },
    { value: 'wholesale', weight: 20, category: 'GENERAL', categoryWeight: 1.0, description: 'Wholesale inquiry' },
    { value: 'distributor', weight: 20, category: 'GENERAL', categoryWeight: 1.0, description: 'Distribution/partnership signal' },
  ];

  // ══════════════════════════════════════════════
  // REGEX PATTERNS — spam detection
  // ══════════════════════════════════════════════
  const regexPatterns = [
    { value: '\\b(?:viagra|cialis|pharmacy)\\b', description: 'Pharma spam' },
    { value: 'https?://bit\\.ly/', description: 'Shortened URL (often spam)' },
    { value: '(?:click|visit|go to)\\s+(?:here|now|this link)', description: 'Spam CTA pattern' },
    { value: '\\$\\d+(?:,\\d{3})*(?:\\.\\d{2})?\\s*(?:per day|daily|weekly)', description: 'Money scam pattern' },
    { value: '(?:dear|hello)\\s+(?:customer|user|member|friend)', description: 'Generic spam greeting' },
  ];

  // ══════════════════════════════════════════════
  // SENDER DOMAIN BLACKLIST
  // ══════════════════════════════════════════════
  const domainBlacklist = [
    { value: 'spam.com', description: 'Known spam domain' },
    { value: 'tempmail.com', description: 'Temporary email service' },
    { value: 'guerrillamail.com', description: 'Disposable email' },
    { value: 'throwaway.email', description: 'Throwaway email service' },
  ];

  // ── Upsert all rules ──
  let count = 0;

  for (const kw of blacklistKeywords) {
    await prisma.qualificationRule.upsert({
      where: { id: `seed-bl-kw-${kw.value.replace(/\s+/g, '-')}` },
      create: {
        id: `seed-bl-kw-${kw.value.replace(/\s+/g, '-')}`,
        type: RuleType.BLACKLIST_KEYWORD,
        value: kw.value,
        description: kw.description,
        createdBy: 'SYSTEM',
        priority: 10, // Blacklist runs first
      },
      update: {},
    });
    count++;
  }

  for (const ph of blacklistPhrases) {
    await prisma.qualificationRule.upsert({
      where: { id: `seed-bl-ph-${ph.value.replace(/\s+/g, '-')}` },
      create: {
        id: `seed-bl-ph-${ph.value.replace(/\s+/g, '-')}`,
        type: RuleType.BLACKLIST_PHRASE,
        value: ph.value,
        description: ph.description,
        createdBy: 'SYSTEM',
        priority: 20,
      },
      update: {},
    });
    count++;
  }

  for (const wl of whitelistKeywords) {
    await prisma.qualificationRule.upsert({
      where: { id: `seed-wl-kw-${wl.value.replace(/\s+/g, '-')}` },
      create: {
        id: `seed-wl-kw-${wl.value.replace(/\s+/g, '-')}`,
        type: RuleType.WHITELIST_KEYWORD,
        value: wl.value,
        weight: wl.weight,
        category: wl.category,
        categoryWeight: wl.categoryWeight,
        description: wl.description,
        createdBy: 'SYSTEM',
        priority: 50,
      },
      update: {},
    });
    count++;
  }

  for (const rp of regexPatterns) {
    await prisma.qualificationRule.upsert({
      where: { id: `seed-rx-${rp.description.replace(/\s+/g, '-').toLowerCase()}` },
      create: {
        id: `seed-rx-${rp.description.replace(/\s+/g, '-').toLowerCase()}`,
        type: RuleType.REGEX_PATTERN,
        value: rp.value,
        description: rp.description,
        createdBy: 'SYSTEM',
        priority: 15,
      },
      update: {},
    });
    count++;
  }

  for (const db of domainBlacklist) {
    await prisma.qualificationRule.upsert({
      where: { id: `seed-db-${db.value.replace(/\./g, '-')}` },
      create: {
        id: `seed-db-${db.value.replace(/\./g, '-')}`,
        type: 'SENDER_DOMAIN_BLACKLIST' as RuleType,
        value: db.value,
        description: db.description,
        createdBy: 'SYSTEM',
        priority: 5, // Domain checks are fastest, run first
      },
      update: {},
    });
    count++;
  }

  console.log(`✅ Seeded ${count} qualification rules`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

---

## Step 6: Migration Commands

```bash
npx prisma migrate dev --name enterprise_v2_complete
npx prisma generate
npx prisma db seed
```

---

**Continue to [Part 2: Contact Module →](./PART2_CONTACT_MODULE.md)**
