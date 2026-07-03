-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('SENDGRID_EMAIL');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "externalAccountId" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_channel_status_idx" ON "ChannelConnection"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_provider_externalAccountId_key" ON "ChannelConnection"("provider", "externalAccountId");
