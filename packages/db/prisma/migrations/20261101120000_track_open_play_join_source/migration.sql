-- CreateEnum
CREATE TYPE "QueueJoinVia" AS ENUM ('SITE', 'JOIN_DM', 'DM_BUTTON');

-- CreateEnum
CREATE TYPE "DiscordClickKind" AS ENUM ('JOIN_COMMAND', 'PANEL_BUTTON', 'TICKER_OFFER', 'AVAILABILITY_OFFER');

-- CreateEnum
CREATE TYPE "DiscordClickOutcome" AS ENUM ('DM_SENT', 'ACTIVE_MATCH', 'DMS_CLOSED', 'SETUP_LINK', 'MATCHED', 'GONE', 'BLOCKED', 'FAILED');

-- AlterTable
ALTER TABLE "QueueActivityLog" ADD COLUMN     "guild_id" TEXT,
ADD COLUMN     "via" "QueueJoinVia";

-- CreateTable
CREATE TABLE "DiscordClick" (
    "id" UUID NOT NULL,
    "kind" "DiscordClickKind" NOT NULL,
    "outcome" "DiscordClickOutcome" NOT NULL,
    "guild_id" TEXT,
    "user_id" UUID,
    "match_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscordClick_created_at_idx" ON "DiscordClick"("created_at");

-- AddForeignKey
ALTER TABLE "DiscordClick" ADD CONSTRAINT "DiscordClick_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
