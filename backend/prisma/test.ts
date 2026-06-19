/**
 * Script to Add a User to the Database
 * 
 * Run: npx ts-node prisma/test.ts
 * 
 * Safe to run multiple times — uses upsert to prevent duplicate usernames/emails.
 */

import { PrismaClient, UserRole } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

dotenv.config(); // Load .env file

// Define the user details to add/update
const USER_DETAILS = {
  userName: 'crazy',
  email: 'crazy@example.com',
  displayName: 'Crazy',
  password: '123456', // Will be hashed with bcrypt
  role: UserRole.SALES, // Available roles: ADMIN, MANAGER, SALES, OPS
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL is not set. Make sure the .env file exists in the backend root directory.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`👤 Preparing to create/update user "${USER_DETAILS.userName}"...`);

  // Hash the password before saving
  const hashedPassword = await bcrypt.hash(USER_DETAILS.password, 10);

  // Check if a user with the same email or userName already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { userName: USER_DETAILS.userName },
        { email: USER_DETAILS.email }
      ]
    }
  });

  if (existingUser) {
    console.log(`⚠️ User with username "${USER_DETAILS.userName}" or email "${USER_DETAILS.email}" already exists (ID: ${existingUser.id}).`);
    
    // Update the existing user
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        displayName: USER_DETAILS.displayName,
        password: hashedPassword,
        role: USER_DETAILS.role,
        isActive: true,
      },
      select: {
        id: true,
        userName: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
      }
    });

    console.log('✅ User updated successfully:', updatedUser);
  } else {
    // Create new user
    const newUser = await prisma.user.create({
      data: {
        userName: USER_DETAILS.userName,
        email: USER_DETAILS.email,
        displayName: USER_DETAILS.displayName,
        password: hashedPassword,
        role: USER_DETAILS.role,
        isActive: true,
      },
      select: {
        id: true,
        userName: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
      }
    });

    console.log('🎉 New user created successfully:', newUser);
  }
}

main()
  .catch((e) => {
    console.error('❌ Script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
