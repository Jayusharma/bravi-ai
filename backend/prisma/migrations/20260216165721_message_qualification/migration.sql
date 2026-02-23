-- CreateEnum
CREATE TYPE "MessageClassification" AS ENUM ('REAL_ENQUIRY', 'SPAM', 'AUTO_REPLY', 'IRRELEVANT', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "classification" "MessageClassification" NOT NULL DEFAULT 'REAL_ENQUIRY';
