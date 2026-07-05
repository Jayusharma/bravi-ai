/**
 * One-time data migration: the single org-wide "Team Chat" room becomes the
 * "general" channel of the Discord-style chat.
 *
 * Run: npx ts-node prisma/migrate-chat-general.ts
 *
 * What it does (IDEMPOTENT — safe to run again):
 *   1. Finds the room with key='COMMON_ROOM' (creates it on a fresh install),
 *      renames it to "general" and sets its description.
 *   2. Upserts a ChatParticipant row for EVERY active user, so all existing
 *      history stays visible to everyone — nothing is lost (messages are
 *      untouched; they stay on the same conversation id).
 *   3. Promotes org ADMIN/MANAGER users to channel ADMIN on #general.
 */

import { PrismaClient, ChatConversationType, ChatParticipantRole, UserRole } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL is not set. Make sure .env file exists.');
    process.exit(1);
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const COMMON_ROOM_KEY = 'COMMON_ROOM';

async function main() {
    console.log('🌱 Migrating the common room into the #general channel...\n');

    // 1. Find-or-create the room, rename to "general"
    const general = await prisma.chatConversation.upsert({
        where: { key: COMMON_ROOM_KEY },
        create: {
            key: COMMON_ROOM_KEY,
            type: ChatConversationType.GROUP,
            name: 'general',
            description: 'Company-wide announcements and general discussions',
        },
        update: {
            name: 'general',
            description: 'Company-wide announcements and general discussions',
        },
    });
    console.log(`  ✅ #general channel ready (${general.id})`);

    // 2. Every active user becomes a member (history + access carry over)
    const users = await prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, userName: true, role: true },
    });

    for (const user of users) {
        // Org admins/managers run the channel; everyone else is a member.
        const channelRole =
            user.role === UserRole.ADMIN || user.role === UserRole.MANAGER
                ? ChatParticipantRole.ADMIN
                : ChatParticipantRole.MEMBER;

        await prisma.chatParticipant.upsert({
            where: { conversationId_userId: { conversationId: general.id, userId: user.id } },
            create: { conversationId: general.id, userId: user.id, role: channelRole },
            update: { isActive: true, role: channelRole },
        });
        console.log(`  ✅ ${user.userName} → ${channelRole}`);
    }

    const messageCount = await prisma.chatMessage.count({ where: { conversationId: general.id } });
    console.log(`\n✅ Done. ${users.length} members on #general, ${messageCount} historical messages intact.\n`);
}

main()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
