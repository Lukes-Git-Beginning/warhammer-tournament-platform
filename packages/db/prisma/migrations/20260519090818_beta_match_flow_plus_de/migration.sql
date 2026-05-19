-- CreateEnum
CREATE TYPE "MatchResultType" AS ENUM ('PLAYER1_WIN', 'PLAYER2_WIN', 'DRAW', 'DOUBLE_LOSS');

-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('WINNERS', 'LOSERS', 'GRAND_FINAL');

-- AlterEnum
ALTER TYPE "MatchStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "first_pick_user_id" UUID;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bracket_side" "BracketSide",
ADD COLUMN     "loser_next_match_id" UUID,
ADD COLUMN     "player1_points" DOUBLE PRECISION,
ADD COLUMN     "player2_points" DOUBLE PRECISION,
ADD COLUMN     "result" "MatchResultType";

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN     "lists_locked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MatchReport" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "result" "MatchResultType" NOT NULL,
    "player1_score" INTEGER,
    "player2_score" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchReport_match_id_idx" ON "MatchReport"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "MatchReport_match_id_reporter_id_key" ON "MatchReport"("match_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_loser_next_match_id_fkey" FOREIGN KEY ("loser_next_match_id") REFERENCES "Match"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
