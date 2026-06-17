-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('INTERNAL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "VariableType" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WaContentType" AS ENUM ('TEXT', 'MEDIA', 'CALL_TO_ACTION', 'QUICK_REPLY');

-- CreateEnum
CREATE TYPE "WaTemplateCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "WaApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "type" "TemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "friendlyName" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "bodyCompiled" TEXT,
    "subject" TEXT,
    "contentType" "WaContentType" NOT NULL DEFAULT 'TEXT',
    "buttons" JSONB,
    "headerMediaUrl" TEXT,
    "contentSid" TEXT,
    "category" "WaTemplateCategory",
    "approvalStatus" "WaApprovalStatus",
    "rejectionReason" TEXT,
    "sampleValues" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVariable" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" "VariableType" NOT NULL,

    CONSTRAINT "TemplateVariable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_name_key" ON "MessageTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_contentSid_key" ON "MessageTemplate"("contentSid");

-- CreateIndex
CREATE INDEX "MessageTemplate_type_channel_isActive_idx" ON "MessageTemplate"("type", "channel", "isActive");

-- CreateIndex
CREATE INDEX "MessageTemplate_approvalStatus_idx" ON "MessageTemplate"("approvalStatus");

-- CreateIndex
CREATE INDEX "TemplateVariable_label_idx" ON "TemplateVariable"("label");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVariable_templateId_position_key" ON "TemplateVariable"("templateId", "position");

-- AddForeignKey
ALTER TABLE "TemplateVariable" ADD CONSTRAINT "TemplateVariable_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
