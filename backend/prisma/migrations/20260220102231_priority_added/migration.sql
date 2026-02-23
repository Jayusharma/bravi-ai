-- CreateEnum
CREATE TYPE "RuleGroupOperator" AS ENUM ('AND', 'OR', 'NOT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RuleType" ADD VALUE 'SENDER_DOMAIN_BLACKLIST';
ALTER TYPE "RuleType" ADD VALUE 'SENDER_DOMAIN_WHITELIST';
ALTER TYPE "RuleType" ADD VALUE 'SENDER_EMAIL_PATTERN';
ALTER TYPE "RuleType" ADD VALUE 'COMPOSITE_GROUP';

-- AlterTable
ALTER TABLE "QualificationRule" ADD COLUMN     "category" TEXT,
ADD COLUMN     "categoryWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "groupOperator" "RuleGroupOperator",
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100;

-- AddForeignKey
ALTER TABLE "QualificationRule" ADD CONSTRAINT "QualificationRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QualificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
