/*
  Warnings:

  - The values [FOLLOWUP_SCHEDULED,ESCALATED] on the enum `EnquiryEventType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `source` on the `Enquiry` table. All the data in the column will be lost.
  - You are about to drop the `Message` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[inboundMessageId]` on the table `Enquiry` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `inboundMessageId` to the `Enquiry` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QualificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'REAL_ENQUIRY', 'SPAM', 'NEEDS_REVIEW', 'REVIEWED_APPROVED', 'REVIEWED_REJECTED');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('BLACKLIST_KEYWORD', 'BLACKLIST_PHRASE', 'WHITELIST_KEYWORD', 'REGEX_PATTERN');

-- CreateEnum
CREATE TYPE "QualificationLayer" AS ENUM ('RULE_BLACKLIST', 'RULE_SHORTTEXT', 'RULE_PATTERN', 'RULE_WHITELIST', 'AI_CLASSIFIER', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "EnquiryIntent" AS ENUM ('PRICING_REQUEST', 'BULK_ORDER', 'PRODUCT_INQUIRY', 'APPOINTMENT', 'COMPLAINT', 'PARTNERSHIP', 'GENERAL_INFO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EnquiryType" AS ENUM ('REAL', 'REVIEW', 'SPAM');

-- AlterEnum
BEGIN;
CREATE TYPE "EnquiryEventType_new" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'REASSIGNED', 'TYPE_CHANGED', 'FOLLOWUP_SENT', 'CUSTOMER_REPLIED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'TAG_ADDED', 'TAG_REMOVED', 'CONVERTED', 'CLOSED', 'REOPENED');
ALTER TABLE "EnquiryTimeline" ALTER COLUMN "type" TYPE "EnquiryEventType_new" USING ("type"::text::"EnquiryEventType_new");
ALTER TYPE "EnquiryEventType" RENAME TO "EnquiryEventType_old";
ALTER TYPE "EnquiryEventType_new" RENAME TO "EnquiryEventType";
DROP TYPE "public"."EnquiryEventType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "MessageChannel" ADD VALUE 'SMS';

-- DropForeignKey
ALTER TABLE "EnquiryTimeline" DROP CONSTRAINT "EnquiryTimeline_enquiryId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_enquiryId_fkey";

-- DropIndex
DROP INDEX "Enquiry_email_idx";

-- DropIndex
DROP INDEX "Enquiry_phone_idx";

-- DropIndex
DROP INDEX "Enquiry_source_idx";

-- AlterTable
ALTER TABLE "Enquiry" DROP COLUMN "source",
ADD COLUMN     "inboundMessageId" TEXT NOT NULL,
ADD COLUMN     "intent" "EnquiryIntent",
ADD COLUMN     "priority" INTEGER,
ADD COLUMN     "type" "EnquiryType" NOT NULL DEFAULT 'REAL',
ADD COLUMN     "urgency" INTEGER;

-- DropTable
DROP TABLE "Message";

-- DropEnum
DROP TYPE "EnquirySource";

-- DropEnum
DROP TYPE "MessageClassification";

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "externalId" TEXT,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "QualificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationRule" (
    "id" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "value" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCaseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationResult" (
    "id" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "finalStatus" "QualificationStatus" NOT NULL,
    "finalLayer" "QualificationLayer" NOT NULL,
    "ruleScore" INTEGER NOT NULL DEFAULT 0,
    "matchedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ruleReason" TEXT,
    "sentToAI" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" INTEGER,
    "aiReason" TEXT,
    "intent" "EnquiryIntent",
    "urgency" INTEGER,
    "priority" INTEGER,
    "extractedData" JSONB,
    "detectedLanguage" TEXT,
    "aiInputTokens" INTEGER,
    "aiOutputTokens" INTEGER,
    "estimatedCostUsd" DECIMAL(10,6),
    "processingTimeMs" INTEGER NOT NULL,
    "wasOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overriddenTo" "QualificationStatus",
    "overriddenBy" TEXT,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundMessage_status_receivedAt_idx" ON "InboundMessage"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundMessage_status_idx" ON "InboundMessage"("status");

-- CreateIndex
CREATE INDEX "InboundMessage_channel_idx" ON "InboundMessage"("channel");

-- CreateIndex
CREATE INDEX "InboundMessage_receivedAt_idx" ON "InboundMessage"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessage_channel_externalId_key" ON "InboundMessage"("channel", "externalId");

-- CreateIndex
CREATE INDEX "QualificationRule_type_isActive_idx" ON "QualificationRule"("type", "isActive");

-- CreateIndex
CREATE INDEX "QualificationRule_isActive_idx" ON "QualificationRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationResult_inboundMessageId_key" ON "QualificationResult"("inboundMessageId");

-- CreateIndex
CREATE INDEX "QualificationResult_finalStatus_createdAt_idx" ON "QualificationResult"("finalStatus", "createdAt");

-- CreateIndex
CREATE INDEX "QualificationResult_finalLayer_idx" ON "QualificationResult"("finalLayer");

-- CreateIndex
CREATE INDEX "QualificationResult_intent_idx" ON "QualificationResult"("intent");

-- CreateIndex
CREATE INDEX "QualificationResult_sentToAI_idx" ON "QualificationResult"("sentToAI");

-- CreateIndex
CREATE INDEX "QualificationResult_createdAt_idx" ON "QualificationResult"("createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_enquiryId_createdAt_idx" ON "ConversationMessage"("enquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_createdAt_idx" ON "ConversationMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_inboundMessageId_key" ON "Enquiry"("inboundMessageId");

-- CreateIndex
CREATE INDEX "Enquiry_type_status_idx" ON "Enquiry"("type", "status");

-- CreateIndex
CREATE INDEX "Enquiry_intent_idx" ON "Enquiry"("intent");

-- CreateIndex
CREATE INDEX "Enquiry_priority_idx" ON "Enquiry"("priority");

-- CreateIndex
CREATE INDEX "Enquiry_type_idx" ON "Enquiry"("type");

-- CreateIndex
CREATE INDEX "EnquiryTimeline_createdAt_idx" ON "EnquiryTimeline"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_status_idx" ON "IdempotencyKey"("status");

-- AddForeignKey
ALTER TABLE "QualificationResult" ADD CONSTRAINT "QualificationResult_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryTimeline" ADD CONSTRAINT "EnquiryTimeline_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
