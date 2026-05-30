-- DropIndex
DROP INDEX "OutboundDraft_enquiryId_channel_createdBy_status_key";

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "lastRetryAt" TIMESTAMP(3),
ADD COLUMN     "queueJobId" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OutboundDeadLetter" (
    "id" TEXT NOT NULL,
    "conversationMessageId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "lastError" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "OutboundDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDeadLetter_conversationMessageId_key" ON "OutboundDeadLetter"("conversationMessageId");

-- CreateIndex
CREATE INDEX "OutboundDeadLetter_createdAt_idx" ON "OutboundDeadLetter"("createdAt");

-- CreateIndex
CREATE INDEX "OutboundDeadLetter_resolvedAt_idx" ON "OutboundDeadLetter"("resolvedAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_queueJobId_idx" ON "ConversationMessage"("queueJobId");

-- CreateIndex
CREATE INDEX "OutboundDraft_enquiryId_channel_createdBy_status_idx" ON "OutboundDraft"("enquiryId", "channel", "createdBy", "status");
