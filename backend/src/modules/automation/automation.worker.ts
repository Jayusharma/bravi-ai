  import 'dotenv/config';
import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { redis } from '../../common/queue/redis.connection';


import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

new Worker(
  'automation',
  async job => {
    const { enquiryId } = job.data;

    // 1️⃣ Re-fetch current state
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) return;

    // 2️⃣ Validate state (CRITICAL)
    if (enquiry.status !== 'QUOTATION_SENT') {
      return;
    }

    // 3️⃣ Execute action (placeholder)
    console.log(`Sending follow-up for enquiry ${enquiryId}`);

    // 4️⃣ Audit
    const alreadySent = await prisma.enquiryTimeline.findFirst({
      where: {
        enquiryId,
        type: 'FOLLOWUP_SENT',
      },
    });
    
    if (alreadySent) {
      return; // idempotent exit
    }
    
    await prisma.enquiryTimeline.create({
      data: {
        enquiryId,
        type: 'FOLLOWUP_SENT',
        createdBy: 'SYSTEM',
      },
    });
  },
  {
    connection: redis,
  },
);
