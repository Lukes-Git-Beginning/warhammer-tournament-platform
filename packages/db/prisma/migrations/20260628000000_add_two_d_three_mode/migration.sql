-- AlterEnum
ALTER TYPE "TournamentMode" ADD VALUE 'TWO_D_THREE';

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN "faction_ids" TEXT[] NOT NULL DEFAULT '{}';
