-- CreateEnum
CREATE TYPE "MatchPhase" AS ENUM ('GROUP_STAGE', 'SWISS', 'PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL');

-- AlterTable
ALTER TABLE "LeaderboardEntry" ADD COLUMN     "season_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "phase" "MatchPhase";

-- CreateIndex
CREATE INDEX "LeaderboardEntry_season_id_season_points_idx" ON "LeaderboardEntry"("season_id", "season_points" DESC);
