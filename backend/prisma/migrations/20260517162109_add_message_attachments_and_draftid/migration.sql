-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CLEARED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "draftId" TEXT;

-- CreateTable
CREATE TABLE "OutboundDraft" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftAttachment" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "conversationMessageId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundDraft_enquiryId_channel_idx" ON "OutboundDraft"("enquiryId", "channel");

-- CreateIndex
CREATE INDEX "OutboundDraft_expiresAt_status_idx" ON "OutboundDraft"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDraft_enquiryId_channel_createdBy_status_key" ON "OutboundDraft"("enquiryId", "channel", "createdBy", "status");

-- CreateIndex
CREATE INDEX "DraftAttachment_draftId_idx" ON "DraftAttachment"("draftId");

-- CreateIndex
CREATE INDEX "MessageAttachment_conversationMessageId_idx" ON "MessageAttachment"("conversationMessageId");

-- AddForeignKey
ALTER TABLE "OutboundDraft" ADD CONSTRAINT "OutboundDraft_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftAttachment" ADD CONSTRAINT "DraftAttachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OutboundDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_conversationMessageId_fkey" FOREIGN KEY ("conversationMessageId") REFERENCES "ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
