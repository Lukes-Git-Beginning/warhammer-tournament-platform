-- Bot message log: every DM/channel message the bot sends (and the ones it deliberately
-- skips: opt-out / rate cap). Additive — no existing table is touched.

-- CreateEnum
CREATE TYPE "BotMessageTarget" AS ENUM ('DM', 'CHANNEL');

-- CreateEnum
CREATE TYPE "BotMessageStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "BotMessage" (
    "id" UUID NOT NULL,
    "target_type" "BotMessageTarget" NOT NULL,
    "target_id" TEXT NOT NULL,
    "kind" TEXT,
    "content" TEXT NOT NULL,
    "status" "BotMessageStatus" NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotMessage_created_at_idx" ON "BotMessage"("created_at");

-- CreateIndex
CREATE INDEX "BotMessage_target_id_created_at_idx" ON "BotMessage"("target_id", "created_at");

-- CreateIndex
CREATE INDEX "BotMessage_status_idx" ON "BotMessage"("status");

-- CreateIndex
CREATE INDEX "BotMessage_kind_created_at_idx" ON "BotMessage"("kind", "created_at");
