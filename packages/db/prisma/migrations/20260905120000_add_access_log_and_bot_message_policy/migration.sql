-- Global access log (login / visit / page-view audit, admin view, 90-day retention),
-- plus a per-user bot message policy (broadcast exclusion / full DM opt-out, admin-set).

-- CreateEnum
CREATE TYPE "AccessEventType" AS ENUM ('LOGIN', 'VISIT', 'PAGE_VIEW');

-- CreateEnum
CREATE TYPE "BotMessagePolicy" AS ENUM ('NORMAL', 'NO_BROADCASTS', 'NO_BOT_MESSAGES');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "bot_message_policy" "BotMessagePolicy" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "AccessEventType" NOT NULL,
    "page" TEXT,
    "path" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessEvent_user_id_created_at_idx" ON "AccessEvent"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "AccessEvent_type_idx" ON "AccessEvent"("type");

-- CreateIndex
CREATE INDEX "AccessEvent_created_at_idx" ON "AccessEvent"("created_at");

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
