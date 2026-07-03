import { PrismaClient, MessageChannel, EnquiryStatus, EnquiryType } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL is not set.');
  process.exit(1);
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const FIRST_NAMES = [
  'Priya', 'Rohan', 'Sneha', 'Amit', 'Neha', 'Vikram', 'Pooja', 'Rahul', 'Ananya', 'Manish',
  'Arjun', 'Karan', 'Deepak', 'Sandeep', 'Sunil', 'Sanjay', 'Vijay', 'Suresh', 'Rajesh', 'Ramesh',
  'Kirti', 'Aditi', 'Divya', 'Shreya', 'Meera', 'Ritu', 'Swati', 'Kavita', 'Priti', 'Nisha'
];

const LAST_NAMES = [
  'Mehta', 'Verma', 'Iyer', 'Patel', 'Kapoor', 'Joshi', 'Nair', 'Das', 'Sharma', 'Gupta',
  'Singh', 'Kumar', 'Reddy', 'Choudhary', 'Pillai', 'Rao', 'Nair', 'Sen', 'Banerjee', 'Mishra'
];

const ORGANIZATIONS = [
  'Tech Corp', 'Verma Enterprises', 'Acme Inc', 'XYZ Solutions', 'LMN Tech',
  'Global Trade', 'Apex Industries', 'Pixel Media', 'Delta Consult', 'Nova retail'
];

const LEAD_SOURCES = ['Website', 'Google Ads', 'Referral', 'Instagram', 'LinkedIn', 'Facebook'];
const TAG_OPTIONS = ['High Potential', 'VIP', 'Interested', 'Warm Lead', 'Cold Lead', 'Follow Up'];

async function main() {
  console.log('🌱 Seeding realistic contacts...');

  // Optional: Clean up existing contacts and enquiries to start fresh
  const deleteEnquiries = await prisma.enquiry.deleteMany({});
  const deleteCount = await prisma.contact.deleteMany({});
  console.log(`🧹 Cleaned up ${deleteEnquiries.count} enquiries and ${deleteCount.count} existing contacts.`);

  // Create 55 contacts
  for (let i = 0; i < 55; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const displayName = `${firstName} ${lastName}`;
    
    const organization = Math.random() > 0.4 ? ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)] : null;
    const notes = Math.random() > 0.5 ? `Interested in properties near Sector ${Math.floor(Math.random() * 100) + 1}.` : null;
    
    // Choose channel
    const useWhatsapp = Math.random() > 0.4;
    const channel = useWhatsapp ? MessageChannel.WHATSAPP : MessageChannel.EMAIL;
    
    let identifier = '';
    if (channel === MessageChannel.WHATSAPP) {
      identifier = `+91 ${Math.floor(Math.random() * 90000) + 10000} ${Math.floor(Math.random() * 90000) + 10000}`;
    } else {
      identifier = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${(organization || 'gmail').replace(/\s+/g, '').toLowerCase()}.com`;
    }

    // Determine status & tags
    const leadSource = LEAD_SOURCES[Math.floor(Math.random() * LEAD_SOURCES.length)];
    const tags = Math.random() > 0.3 ? [TAG_OPTIONS[Math.floor(Math.random() * TAG_OPTIONS.length)]] : [];
    if (Math.random() > 0.7 && tags.length > 0) {
      tags.push('VIP');
    }

    const isActive = Math.random() > 0.3; // 70% active, 30% inactive
    const status = isActive 
      ? [EnquiryStatus.NEW, EnquiryStatus.OPEN, EnquiryStatus.IN_PROGRESS, EnquiryStatus.AWAITING_CUSTOMER, EnquiryStatus.FOLLOW_UP][Math.floor(Math.random() * 5)]
      : [EnquiryStatus.CONVERTED, EnquiryStatus.CLOSED_LOST][Math.floor(Math.random() * 2)];

    // Create contact, channel, and enquiry
    const contact = await prisma.contact.create({
      data: {
        displayName,
        organization,
        notes,
        firstSeenAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // seen within last 30 days
        lastSeenAt: new Date(Date.now() - Math.random() * 5 * 24 * 60 * 60 * 1000),   // last active within 5 days
        channels: {
          create: {
            channel,
            identifier,
            isPrimary: true,
            isVerified: true,
          }
        },
        enquiries: {
          create: {
            type: EnquiryType.REAL,
            status,
            tags,
            priority: Math.floor(Math.random() * 10) + 1,
            urgency: Math.floor(Math.random() * 5) + 1,
          }
        }
      }
    });

    console.log(`✅ Created contact: ${contact.displayName} with status: ${status}`);
  }

  console.log('🎉 Seeding contacts complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
