/*
  Warnings:

  - The values [TYPE_CHANGED] on the enum `EnquiryEventType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `email` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `inboundMessageId` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Enquiry` table. All the data in the column will be lost.
  - Added the required column `contactId` to the `Enquiry` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "EnquiryEventType_new" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'REASSIGNED', 'FOLLOWUP_SENT', 'FOLLOWUP_SCHEDULED', 'CUSTOMER_REPLIED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'TAG_ADDED', 'TAG_REMOVED', 'NOTE_ADDED', 'CONVERTED', 'CLOSED', 'REOPENED', 'CONTACT_MERGED', 'AUTO_ASSIGNED', 'STALE_DETECTED');
ALTER TABLE "EnquiryTimeline" ALTER COLUMN "type" TYPE "EnquiryEventType_new" USING ("type"::text::"EnquiryEventType_new");
ALTER TYPE "EnquiryEventType" RENAME TO "EnquiryEventType_old";
ALTER TYPE "EnquiryEventType_new" RENAME TO "EnquiryEventType";
DROP TYPE "public"."EnquiryEventType_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnquiryIntent" ADD VALUE 'SHIPPING_INQUIRY';
ALTER TYPE "EnquiryIntent" ADD VALUE 'DOCUMENT_SUBMIT';
ALTER TYPE "EnquiryIntent" ADD VALUE 'RETURN_REFUND';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EnquiryStatus" ADD VALUE 'AWAITING_CUSTOMER';
ALTER TYPE "EnquiryStatus" ADD VALUE 'STALE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QualificationLayer" ADD VALUE 'RULE_DUPLICATE';
ALTER TYPE "QualificationLayer" ADD VALUE 'RULE_DOMAIN';

-- DropForeignKey
ALTER TABLE "Enquiry" DROP CONSTRAINT "Enquiry_inboundMessageId_fkey";

-- DropIndex
DROP INDEX "Enquiry_inboundMessageId_key";

-- DropIndex
DROP INDEX "Enquiry_type_idx";

-- DropIndex
DROP INDEX "QualificationRule_isActive_idx";

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "sentByUserId" TEXT;

-- AlterTable
ALTER TABLE "Enquiry" DROP COLUMN "email",
DROP COLUMN "inboundMessageId",
DROP COLUMN "name",
DROP COLUMN "phone",
ADD COLUMN     "contactId" TEXT NOT NULL,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "contentFingerprint" TEXT;

-- AlterTable
ALTER TABLE "QualificationResult" ADD COLUMN     "matchedRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "QualificationRule" ADD COLUMN     "hitCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastHitAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT 'Unknown',
    "organization" TEXT,
    "notes" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactChannel" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "identifier" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_displayName_idx" ON "Contact"("displayName");

-- CreateIndex
CREATE INDEX "Contact_lastSeenAt_idx" ON "Contact"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ContactChannel_contactId_idx" ON "ContactChannel"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactChannel_channel_identifier_key" ON "ContactChannel"("channel", "identifier");

-- CreateIndex
CREATE INDEX "InternalNote_enquiryId_createdAt_idx" ON "InternalNote"("enquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_externalId_idx" ON "ConversationMessage"("externalId");

-- CreateIndex
CREATE INDEX "Enquiry_contactId_status_idx" ON "Enquiry"("contactId", "status");

-- CreateIndex
CREATE INDEX "Enquiry_lastActivityAt_idx" ON "Enquiry"("lastActivityAt");

-- CreateIndex
CREATE INDEX "EnquiryTimeline_type_idx" ON "EnquiryTimeline"("type");

-- CreateIndex
CREATE INDEX "InboundMessage_contactId_idx" ON "InboundMessage"("contactId");

-- CreateIndex
CREATE INDEX "InboundMessage_contentFingerprint_idx" ON "InboundMessage"("contentFingerprint");

-- CreateIndex
CREATE INDEX "QualificationRule_isActive_priority_idx" ON "QualificationRule"("isActive", "priority");

-- AddForeignKey
ALTER TABLE "ContactChannel" ADD CONSTRAINT "ContactChannel_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
