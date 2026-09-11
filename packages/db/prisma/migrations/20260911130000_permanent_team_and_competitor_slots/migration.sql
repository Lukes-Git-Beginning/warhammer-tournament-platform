-- 2v2 / Competitor abstraction (plans/2v2-competitor-implementation.md, design doc §5).
--
-- Match.player1_id/player2_id/winner_id become OPAQUE competitor ids — a User id for
-- 1v1, a Team id for 2v2 (team-as-actor). The three FK constraints to User are dropped;
-- the columns + their indexes stay. No FK replaces them (a slot may point at User OR Team);
-- resolution happens in lib/competitors.ts via the tournament's competitor_format.
--
-- Team becomes a PERMANENT entity (was an unused per-tournament stub, 0 rows): drop
-- tournament_id, add a canonical roster_key (unique) for find-or-create by member set,
-- a lifecycle status, and audit timestamps. TeamMember gains invite/consent columns
-- (accepted_at null = pending the Discord-DM invite). Because Team was never populated,
-- the NOT NULL adds (roster_key, updated_at) are safe.
--
-- TournamentParticipant.participant_type discriminates USER vs TEAM entries.

-- CreateEnum
CREATE TYPE "CompetitorType" AS ENUM ('USER', 'TEAM');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('FORMING', 'ACTIVE', 'ARCHIVED');

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_player1_id_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_player2_id_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_winner_id_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_tournament_id_fkey";

-- DropIndex
DROP INDEX "Team_tournament_id_idx";

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN     "participant_type" "CompetitorType" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "tournament_id",
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "roster_key" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "status" "TeamStatus" NOT NULL DEFAULT 'FORMING',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Team_roster_key_key" ON "Team"("roster_key");

-- CreateIndex
CREATE INDEX "Team_captain_id_idx" ON "Team"("captain_id");

-- CreateIndex
CREATE INDEX "Team_status_idx" ON "Team"("status");

-- CreateIndex
CREATE INDEX "TeamMember_user_id_idx" ON "TeamMember"("user_id");
