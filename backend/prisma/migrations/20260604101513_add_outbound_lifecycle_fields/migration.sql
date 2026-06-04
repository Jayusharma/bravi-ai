-- CreateEnum
CREATE TYPE "DeleteReason" AS ENUM ('CUSTOMER_REVOKED', 'AGENT_DELETED', 'ADMIN_PURGED');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('HUMAN', 'AI_ASSISTED', 'AUTOMATION', 'VOICE');

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletedReason" "DeleteReason",
ADD COLUMN     "source" "MessageSource" NOT NULL DEFAULT 'HUMAN';

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "lastReadAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "isRevoked" BOOLEAN NOT NULL DEFAULT false;
