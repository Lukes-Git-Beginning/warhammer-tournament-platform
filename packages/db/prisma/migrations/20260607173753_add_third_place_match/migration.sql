-- AlterEnum
ALTER TYPE "MatchPhase" ADD VALUE 'PLAYOFF_THIRD_PLACE';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "has_third_place_match" BOOLEAN NOT NULL DEFAULT false;
