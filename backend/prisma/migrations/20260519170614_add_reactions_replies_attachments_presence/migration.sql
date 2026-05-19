-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentKind" ADD VALUE 'AUDIO';
ALTER TYPE "AttachmentKind" ADD VALUE 'VOICE_NOTE';

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replyToId" TEXT;

-- AlterTable
ALTER TABLE "DraftAttachment" ADD COLUMN     "cdnUrl" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "MessageAttachment" ADD COLUMN     "cdnUrl" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "thumbnailKey" TEXT,
ADD COLUMN     "waveformData" JSONB,
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPresence" (
    "userId" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ContactPreference" (
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil" TIMESTAMP(3),
    "pinnedAt" TIMESTAMP(3),

    CONSTRAINT "ContactPreference_pkey" PRIMARY KEY ("userId","contactId")
);

-- CreateTable
CREATE TABLE "ConversationRead" (
    "userId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("userId","enquiryId")
);

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "ConversationMessageRead_messageId_idx" ON "ConversationMessageRead"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessageRead_messageId_userId_key" ON "ConversationMessageRead"("messageId", "userId");

-- CreateIndex
CREATE INDEX "ContactPreference_userId_isPinned_idx" ON "ContactPreference"("userId", "isPinned");

-- CreateIndex
CREATE INDEX "ContactPreference_userId_isArchived_idx" ON "ContactPreference"("userId", "isArchived");

-- CreateIndex
CREATE INDEX "ConversationRead_userId_idx" ON "ConversationRead"("userId");

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessageRead" ADD CONSTRAINT "ConversationMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
