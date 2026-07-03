/**
 * Permission Seed Script
 * 
 * Run: npx ts-node prisma/seed-permissions.ts
 * 
 * Seeds the Permission table with all possible actions × subjects,
 * then creates default RolePermission mappings.
 * 
 * Safe to run multiple times — uses upsert.
 */

import { PrismaClient, UserRole } from '@prisma/client';
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

// ─── Define all permission subjects and actions ─────────────────────────

const SUBJECTS = [
  'enquiry',
  'user',
  'message',
  'dashboard',
  'outbounddraft',
  'conversationmessage',
  'messagetemplate',
  'deadletter',
  'chat',
  'contact',
  'channelconnection',
  'all',
];
const ACTIONS = ['create', 'read', 'update', 'delete', 'assign', 'manage'];

// ─── Define default role → permission mappings ─────────────────────────

interface RoleMapping {
    action: string;
    subject: string;
    conditions?: any;
}

const DEFAULT_ROLE_PERMISSIONS: Record<string, RoleMapping[]> = {
    ADMIN: [
        // Admin gets full access via "manage:all"
        { action: 'manage', subject: 'all' },
    ],

    MANAGER: [
        // Full enquiry access
        { action: 'read', subject: 'enquiry' },
        { action: 'create', subject: 'enquiry' },
        { action: 'update', subject: 'enquiry' },
        { action: 'assign', subject: 'enquiry' },
        // Can read users but not create/delete
        { action: 'read', subject: 'user' },
        // Full message access
        { action: 'read', subject: 'message' },
        { action: 'create', subject: 'message' },
        // Dashboard
        { action: 'read', subject: 'dashboard' },
        // Outbound
        { action: 'create', subject: 'outbounddraft' },
        { action: 'read', subject: 'outbounddraft' },
        { action: 'update', subject: 'outbounddraft' },
        { action: 'delete', subject: 'outbounddraft' },
        { action: 'read', subject: 'conversationmessage' },
        { action: 'create', subject: 'conversationmessage' },
        { action: 'update', subject: 'conversationmessage' },
        // Message templates — managers manage the full lifecycle
        { action: 'read', subject: 'messagetemplate' },
        { action: 'create', subject: 'messagetemplate' },
        { action: 'update', subject: 'messagetemplate' },
        { action: 'delete', subject: 'messagetemplate' },
        // Dead letter queue — managers can read and retry
        { action: 'read', subject: 'deadletter' },
        { action: 'manage', subject: 'deadletter' },
        // Internal chat — full participation (send, pin, delete own)
        { action: 'read', subject: 'chat' },
        { action: 'create', subject: 'chat' },
        { action: 'update', subject: 'chat' },
        { action: 'delete', subject: 'chat' },
        // Contact permissions
        { action: 'read', subject: 'contact' },
        { action: 'create', subject: 'contact' },
        { action: 'update', subject: 'contact' },
        { action: 'delete', subject: 'contact' },
    ],

    SALES: [
        // Can read all enquiries, but update only assigned ones
        { action: 'read', subject: 'enquiry' },
        { action: 'create', subject: 'enquiry' },
        { action: 'update', subject: 'enquiry', conditions: { assignedToId: '$userId' } },
        // Messages — can read and send for assigned enquiries
        { action: 'read', subject: 'message' },
        { action: 'create', subject: 'message' },
        // Dashboard (own stats)
        { action: 'read', subject: 'dashboard' },
        // Outbound — draft and send
        { action: 'create', subject: 'outbounddraft' },
        { action: 'read', subject: 'outbounddraft' },
        { action: 'update', subject: 'outbounddraft' },
        { action: 'delete', subject: 'outbounddraft' },
        { action: 'read', subject: 'conversationmessage' },
        { action: 'create', subject: 'conversationmessage' },
        { action: 'update', subject: 'conversationmessage' },
        // Message templates — sales can read + use them (no edit/delete)
        { action: 'read', subject: 'messagetemplate' },
        // Internal chat — full participation (send, pin, delete own)
        { action: 'read', subject: 'chat' },
        { action: 'create', subject: 'chat' },
        { action: 'update', subject: 'chat' },
        { action: 'delete', subject: 'chat' },
        // Contact permissions
        { action: 'read', subject: 'contact' },
        { action: 'update', subject: 'contact' },
    ],

    OPS: [
        // Read-only access
        { action: 'read', subject: 'enquiry' },
        { action: 'read', subject: 'message' },
        { action: 'read', subject: 'dashboard' },
        // Outbound — read-only
        { action: 'read', subject: 'outbounddraft' },
        { action: 'read', subject: 'conversationmessage' },
        // Message templates — read-only
        { action: 'read', subject: 'messagetemplate' },
        // Internal chat — can read and send (no pin/delete)
        { action: 'read', subject: 'chat' },
        { action: 'create', subject: 'chat' },
        // Contact permissions
        { action: 'read', subject: 'contact' },
    ],
};

// ─── Seed Logic ─────────────────────────────────────────────────────────

async function main() {
    console.log('🌱 Seeding permissions...\n');

    // 1. Create all permission entries
    const permissionMap = new Map<string, string>(); // "action:subject" → id

    for (const subject of SUBJECTS) {
        for (const action of ACTIONS) {
            const key = `${action}:${subject}`;
            const perm = await prisma.permission.upsert({
                where: { action_subject: { action, subject } },
                create: { action, subject },
                update: {},
            });
            permissionMap.set(key, perm.id);
            console.log(`  ✅ Permission: ${key} (${perm.id})`);
        }
    }

    console.log(`\n📦 Created ${permissionMap.size} permissions\n`);

    // 2. Create role → permission mappings
    for (const [roleName, mappings] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        const role = roleName as UserRole;
        console.log(`\n🔐 Setting up ${role} permissions:`);

        for (const mapping of mappings) {
            const key = `${mapping.action}:${mapping.subject}`;
            const permissionId = permissionMap.get(key);

            if (!permissionId) {
                console.log(`  ⚠️  Skipping unknown permission: ${key}`);
                continue;
            }

            try {
                await prisma.rolePermission.upsert({
                    where: {
                        role_permissionId: { role, permissionId },
                    },
                    create: {
                        role,
                        permissionId,
                        conditions: mapping.conditions || undefined,
                    },
                    update: {
                        conditions: mapping.conditions || undefined,
                    },
                });
                console.log(`  ✅ ${role} → ${key}${mapping.conditions ? ` (conditional)` : ''}`);
            } catch (e: any) {
                console.log(`  ⚠️  Error setting ${role} → ${key}: ${e.message}`);
            }
        }
    }

    console.log('\n✅ Permission seeding complete!\n');

    // 3. Create default user (if not exists)
    console.log('\n👤 Creating default admin user (if not exists):');

    const existingAdmin = await prisma.user.findUnique({
        where: { email: 'admin@example.com' },
    });

    if (existingAdmin) {
        console.log('  ✅ Admin user already exists');
    } else {
        const hashedPassword = await bcrypt.hash('123456', 10);
        const admin = await prisma.user.create({
            data: {
                email: 'admin@example.com',
                password: hashedPassword,
                userName: 'Jay',
                role: UserRole.ADMIN,
            },
        });
        console.log(`  ✅ Admin user created: ${admin.email} (${admin.id})`);
    }
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
