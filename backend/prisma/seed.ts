import { PrismaClient, UserRole , RuleType} from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

dotenv.config(); // Load .env file

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL is not set. Make sure .env file exists.');
    process.exit(1);
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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