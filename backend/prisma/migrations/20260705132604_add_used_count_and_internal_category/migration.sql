-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "internalCategory" TEXT,
ADD COLUMN     "usedCount" INTEGER NOT NULL DEFAULT 0;
