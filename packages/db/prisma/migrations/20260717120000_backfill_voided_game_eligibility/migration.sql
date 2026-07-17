-- The game-level `counts_for_leaderboard` flag is now the single source of truth for
-- all statistics (matchup heatmaps, rating model, faction winrates). Historically,
-- voiding or cancelling a match only set the flag on the Match row, leaving its games
-- leaderboard-eligible. Correct existing data so a voided or cancelled match's games are
-- excluded everywhere. Idempotent (only flips still-true rows).
UPDATE "MatchGame" AS g
SET "counts_for_leaderboard" = false
FROM "Match" AS m
WHERE g."match_id" = m."id"
  AND g."counts_for_leaderboard" = true
  AND (m."counts_for_leaderboard" = false OR m."status" = 'CANCELLED');
