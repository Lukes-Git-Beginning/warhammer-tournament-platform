-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('TOURNAMENT', 'OPEN_PLAY');

-- CreateEnum
CREATE TYPE "AvailabilityContext" AS ENUM ('TOURNAMENT', 'MATCHMAKING');

-- CreateEnum
CREATE TYPE "ScheduledMatchupStatus" AS ENUM ('OPEN', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "type" "MatchType" NOT NULL DEFAULT 'TOURNAMENT',
ALTER COLUMN "tournament_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AvailabilitySlot" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "hour_utc" INTEGER NOT NULL,
    "context" "AvailabilityContext" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMatchup" (
    "id" UUID NOT NULL,
    "proposer_id" UUID NOT NULL,
    "format" "MatchFormat" NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "ScheduledMatchupStatus" NOT NULL DEFAULT 'OPEN',
    "accepted_by_id" UUID,
    "match_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledMatchup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvailabilitySlot_day_of_week_hour_utc_context_idx" ON "AvailabilitySlot"("day_of_week", "hour_utc", "context");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilitySlot_user_id_day_of_week_hour_utc_context_key" ON "AvailabilitySlot"("user_id", "day_of_week", "hour_utc", "context");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMatchup_match_id_key" ON "ScheduledMatchup"("match_id");

-- CreateIndex
CREATE INDEX "ScheduledMatchup_status_expires_at_idx" ON "ScheduledMatchup"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ScheduledMatchup_proposer_id_idx" ON "ScheduledMatchup"("proposer_id");

-- CreateIndex
CREATE INDEX "ScheduledMatchup_proposed_at_idx" ON "ScheduledMatchup"("proposed_at");

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMatchup" ADD CONSTRAINT "ScheduledMatchup_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMatchup" ADD CONSTRAINT "ScheduledMatchup_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
