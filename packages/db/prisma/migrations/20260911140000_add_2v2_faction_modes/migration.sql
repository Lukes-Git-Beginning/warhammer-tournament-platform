-- 2v2 faction mechanics (Phase B, plans/2v2-competitor-implementation.md).
--
-- Dedicated 2v2 modes so the 1v1 faction handlers stay untouched (no cross-wiring):
--   SFT_2V2 — captain pre-picks one faction per member at registration (participant.faction_ids)
--   BPT_2V2 — captain blind-picks one faction per member per game
-- Both require competitor_format = TWO_V_TWO. Each side of a 2v2 game carries TWO factions
-- (captain + teammate, positional), stored additively as *_faction_id_2 (NULL for 1v1) on
-- MatchGame and MatchBlindPick — the 1v1 single-faction columns are unchanged.

-- AlterEnum
ALTER TYPE "TournamentMode" ADD VALUE 'SFT_2V2';
ALTER TYPE "TournamentMode" ADD VALUE 'BPT_2V2';

-- AlterTable
ALTER TABLE "MatchGame" ADD COLUMN     "player1_faction_id_2" TEXT,
ADD COLUMN     "player2_faction_id_2" TEXT;

-- AlterTable
ALTER TABLE "MatchBlindPick" ADD COLUMN     "player1_faction_id_2" TEXT,
ADD COLUMN     "player2_faction_id_2" TEXT;
