# 🚀 Enterprise Enquiry Qualification System — Part 1: Setup & Foundation

> **Production-grade lead qualification pipeline** with 3-layer intelligence (Rules → AI → Human Review), BullMQ async processing, event-driven enquiry creation, and full audit trail.

---

## Architecture Overview

```
WhatsApp/Email Webhook
        ↓
  WebhookController (parses raw payload)
        ↓
  IngestionService.ingest()
        ↓
  InboundMessage saved (status: PENDING)
        ↓
  Job queued → BullMQ 'qualification' queue
        ↓
  QualificationProcessor picks up job
        ↓
  QualificationService.qualify()
        ↓
  Layer 1: RuleEngineStrategy.evaluate()
    ├─ 1a: Blacklist check → SPAM
    ├─ 1b: Short text check → SPAM
    ├─ 1c: Regex pattern check → SPAM
    ├─ 1d: Keyword score → REAL_ENQUIRY (if score ≥ threshold)
    └─ Ambiguous → Layer 2
        ↓
  Layer 2: AIClassifierStrategy.classify()
    ├─ High confidence → REAL_ENQUIRY or SPAM
    └─ Low confidence → NEEDS_REVIEW
        ↓
  If REAL_ENQUIRY → EventEmitter 'enquiry.qualified'
        ↓
  EnquiryService @OnEvent('enquiry.qualified')
        ↓
  Enquiry created (type: REAL) → Sales inbox
```

---

## Step 1: Install Dependencies

```bash
npm install @anthropic-ai/sdk @nestjs/bullmq @nestjs/event-emitter
```

> You already have `bullmq`, `ioredis` in package.json. These add the NestJS wrappers + Anthropic SDK.

---

## Step 2: Environment Variables

Add to `.env`:

```env
# ── Existing ──
DATABASE_URL="postgresql://eventops:eventops@localhost:5432/eventops_db"

# ── NEW: Add these ──
JWT_SECRET=your-jwt-secret-here
FRONTEND_URL=http://localhost:3000

# AI Qualification
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx

# Redis (for BullMQ queues)
REDIS_HOST=localhost
REDIS_PORT=6379

# Business context — improves AI accuracy dramatically
QUALIFICATION_BUSINESS_CONTEXT="a B2B electronics wholesale distributor selling components, circuits, and bulk electronic parts"
QUALIFICATION_AI_CONFIDENCE_THRESHOLD=65
QUALIFICATION_KEYWORD_SCORE_THRESHOLD=30
```

---

## Step 3: Prisma Seed File

### `prisma/seed.ts`

```typescript
// prisma/seed.ts
// Seeds default qualification rules for the rule engine

import 'dotenv/config';
import { PrismaClient, RuleType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding qualification rules...');

  // ── Blacklist Keywords (spam indicators) ──
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
  ];

  // ── Blacklist Phrases (exact match spam) ──
  const blacklistPhrases = [
    { value: 'this is not spam', description: 'Ironic spam self-declaration' },
    { value: 'dear sir/madam', description: 'Generic spam greeting' },
    { value: 'nigerian prince', description: 'Classic scam pattern' },
    { value: 'wire transfer', description: 'Financial scam indicator' },
  ];

  // ── Whitelist Keywords (business intent signals) ──
  const whitelistKeywords = [
    { value: 'quote', weight: 20, description: 'Pricing intent signal' },
    { value: 'quotation', weight: 25, description: 'Strong pricing intent' },
    { value: 'price', weight: 15, description: 'Pricing inquiry' },
    { value: 'pricing', weight: 15, description: 'Pricing inquiry' },
    { value: 'bulk order', weight: 30, description: 'High-value bulk intent' },
    { value: 'wholesale', weight: 25, description: 'Wholesale buying intent' },
    { value: 'purchase', weight: 20, description: 'Purchase intent' },
    { value: 'order', weight: 15, description: 'Order intent' },
    { value: 'quantity', weight: 15, description: 'Volume signal' },
    { value: 'delivery', weight: 10, description: 'Logistics interest' },
    { value: 'shipping', weight: 10, description: 'Logistics interest' },
    { value: 'catalog', weight: 15, description: 'Product browsing intent' },
    { value: 'catalogue', weight: 15, description: 'Product browsing intent' },
    { value: 'specifications', weight: 15, description: 'Technical interest' },
    { value: 'MOQ', weight: 25, description: 'Minimum order quantity — strong B2B signal' },
    { value: 'payment terms', weight: 20, description: 'Commercial negotiation signal' },
    { value: 'lead time', weight: 20, description: 'Supply chain intent' },
    { value: 'sample', weight: 15, description: 'Product evaluation intent' },
    { value: 'distributor', weight: 20, description: 'Partnership intent' },
    { value: 'partnership', weight: 20, description: 'Business collaboration' },
    { value: 'urgent', weight: 10, description: 'Urgency signal' },
    { value: 'ASAP', weight: 10, description: 'Urgency signal' },
    { value: 'budget', weight: 15, description: 'Financial readiness' },
    { value: 'invoice', weight: 15, description: 'Transaction intent' },
    { value: 'requirement', weight: 15, description: 'Need statement' },
    { value: 'interested in', weight: 20, description: 'Direct interest expression' },
  ];

  // ── Regex Patterns (spam detection) ──
  const regexPatterns = [
    { value: '\\b(?:viagra|cialis|pharmacy)\\b', description: 'Pharma spam' },
    { value: '\\b\\d{3}[-.]\\d{3}[-.]\\d{4}\\b.*(?:call|dial)', description: 'Phone spam CTA' },
    { value: 'https?://bit\\.ly/', description: 'Shortened URL (often spam)' },
    { value: '(?:click|visit|go to)\\s+(?:here|now|this link)', description: 'Spam CTA pattern' },
    { value: '\\$\\d+(?:,\\d{3})*(?:\\.\\d{2})?\\s*(?:per day|daily|weekly)', description: 'Money scam pattern' },
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
        description: wl.description,
        createdBy: 'SYSTEM',
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

Add to `package.json`:

```json
{
  "prisma": {
    "seed": "npx ts-node prisma/seed.ts"
  }
}
```

Run:

```bash
npx prisma migrate dev --name complete_qualification_system
npx prisma generate
npx prisma db seed
```

---

## Step 4: Update `app.module.ts`

```typescript
// src/app.module.ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { EnquiryModule } from './modules/enquiry/enquiry.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { QualificationModule } from './modules/qualification/qualification.module';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { WebhookModule } from './modules/webhooks/webhook.module';
import { CaslModule } from './modules/casl/casl.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // ── Event System (for enquiry.qualified events) ──
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // ── BullMQ Queue System ──
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
        },
      }),
      inject: [ConfigService],
    }),       

    PrismaModule,
    AuthModule,
    UserModule,
    IngestionModule,
    QualificationModule,
    EnquiryModule,
    WebhookModule,
    CaslModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdempotencyMiddleware).forRoutes('webhook');
  }
}
```

---

## Step 5: Update CASL Types

Add new subjects for qualification system in `src/modules/casl/casl.types.ts`:

```typescript
import { AbilityClass, PureAbility } from '@casl/ability';
import { PrismaQuery } from '@casl/prisma';

export type Actions =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'assign'
  | 'manage';

export type AppSubjects =
  | 'Enquiry'
  | 'Message'
  | 'User'
  | 'Permission'
  | 'Dashboard'
  | 'InboundMessage'
  | 'QualificationRule'
  | 'QualificationResult'
  | 'all';

export type AppAbility = PureAbility<[Actions, AppSubjects], PrismaQuery>;

export const AppAbility = PureAbility as AbilityClass<AppAbility>;
```

---

**Continue to [Part 2: Ingestion Module](./SYSTEM_DESIGN_PART2_INGESTION.md)**
