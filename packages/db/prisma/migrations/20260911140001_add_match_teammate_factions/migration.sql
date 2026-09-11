-- 2v2 (Phase B): mirror the teammate's faction per side onto Match, matching the existing
-- per-match summary columns player1_faction_id/player2_faction_id (authoritative per-game
-- factions live on MatchGame). NULL for 1v1. See plans/2v2-competitor-implementation.md.

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "player1_faction_id_2" TEXT,
ADD COLUMN     "player2_faction_id_2" TEXT;
