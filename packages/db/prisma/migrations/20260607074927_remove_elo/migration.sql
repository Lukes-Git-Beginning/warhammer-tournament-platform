/*
  Warnings:

  - You are about to drop the column `elo_rating` on the `LeaderboardEntry` table. All the data in the column will be lost.
  - You are about to drop the column `matches_played` on the `LeaderboardEntry` table. All the data in the column will be lost.
  - You are about to drop the column `elo_change` on the `TournamentResult` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LeaderboardEntry" DROP COLUMN "elo_rating",
DROP COLUMN "matches_played",
ADD COLUMN     "games_played" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TournamentResult" DROP COLUMN "elo_change";

-- RenameIndex
ALTER INDEX "ExternalGame_source_external_tournament_id_round_player1_name_p" RENAME TO "ExternalGame_source_external_tournament_id_round_player1_na_key";
