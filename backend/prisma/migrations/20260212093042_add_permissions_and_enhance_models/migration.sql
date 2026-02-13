/*
  Warnings:

  - You are about to drop the column `status` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EnquirySource" AS ENUM ('MANUAL', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'QUOTATION_SENT', 'FOLLOW_UP', 'CONVERTED', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "EnquiryEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'REASSIGNED', 'FOLLOWUP_SENT', 'FOLLOWUP_SCHEDULED', 'CUSTOMER_REPLIED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'ESCALATED', 'TAG_ADDED', 'TAG_REMOVED', 'CONVERTED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'MANAGER';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "status",
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropEnum
DROP TYPE "UserStatus";

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissionId" TEXT NOT NULL,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" "EnquirySource" NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lostReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastCustomerReplyAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryTimeline" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "type" "EnquiryEventType" NOT NULL,
    "fromStatus" "EnquiryStatus",
    "toStatus" "EnquiryStatus",
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "externalId" TEXT,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_action_subject_key" ON "Permission"("action", "subject");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON "RolePermission"("role", "permissionId");

-- CreateIndex
CREATE INDEX "Enquiry_status_idx" ON "Enquiry"("status");

-- CreateIndex
CREATE INDEX "Enquiry_assignedToId_idx" ON "Enquiry"("assignedToId");

-- CreateIndex
CREATE INDEX "Enquiry_source_idx" ON "Enquiry"("source");

-- CreateIndex
CREATE INDEX "Enquiry_createdAt_idx" ON "Enquiry"("createdAt");

-- CreateIndex
CREATE INDEX "Enquiry_email_idx" ON "Enquiry"("email");

-- CreateIndex
CREATE INDEX "Enquiry_phone_idx" ON "Enquiry"("phone");

-- CreateIndex
CREATE INDEX "EnquiryTimeline_enquiryId_createdAt_idx" ON "EnquiryTimeline"("enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE INDEX "Message_enquiryId_createdAt_idx" ON "Message"("enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_channel_externalId_key" ON "Message"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryTimeline" ADD CONSTRAINT "EnquiryTimeline_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
