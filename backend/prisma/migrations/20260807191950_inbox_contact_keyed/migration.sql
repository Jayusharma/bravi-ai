-- DropForeignKey
ALTER TABLE "ConversationMessageRead" DROP CONSTRAINT "ConversationMessageRead_messageId_fkey";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "lastMessageSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastReadSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "clientMessageId" TEXT,
ADD COLUMN     "contactId" TEXT NOT NULL,
ADD COLUMN     "seq" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Enquiry" DROP COLUMN "lastReadAt";

-- DropTable
DROP TABLE "ConversationMessageRead";

-- DropTable
DROP TABLE "ConversationRead";

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_clientMessageId_key" ON "ConversationMessage"("clientMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_contactId_seq_idx" ON "ConversationMessage"("contactId", "seq" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_contactId_seq_key" ON "ConversationMessage"("contactId", "seq");

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

