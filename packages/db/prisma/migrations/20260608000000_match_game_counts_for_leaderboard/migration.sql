-- AlterTable: stamp each MatchGame with the leaderboard-counting flag from its
-- tournament, so the flag travels with the game record rather than requiring a
-- tournament join on every filter query.
ALTER TABLE "MatchGame" ADD COLUMN "counts_for_leaderboard" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: propagate the tournament flag to all existing game rows.
UPDATE "MatchGame" mg
SET    counts_for_leaderboard = t.counts_for_leaderboard
FROM   "Match" m
JOIN   "Tournament" t ON m.tournament_id = t.id
WHERE  mg.match_id = m.id;
