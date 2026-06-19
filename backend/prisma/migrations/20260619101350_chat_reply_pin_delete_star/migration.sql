-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "deletedFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isStarred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentMessageId" TEXT;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
