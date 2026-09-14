-- Drop the legacy points system (the never-intended "3-for-win" / all-time board).
-- The leaderboard is now GS-derived live from match facts; nothing reads these any more.

-- DropTable (LeaderboardEntry: total_points/games_played/wins/losses per user × version)
DROP TABLE "LeaderboardEntry";

-- AlterTable — drop the per-match Swiss/round "points" (the visible "3/1/0")
ALTER TABLE "Match" DROP COLUMN "player1_points",
DROP COLUMN "player2_points";

-- AlterTable — drop tournament placement points (placement itself is kept)
ALTER TABLE "TournamentResult" DROP COLUMN "points_earned";
