-- Games-only statistics: backfill MatchGame rows for legacy matches so every real
-- played match carries its game row(s). Statistics derive exclusively from MatchGame
-- (the statistical unit); the match is just a container. Additive + idempotent +
-- reversible. FORFEIT/BYE/CANCELLED/NO_CONTEST are containers without a played game
-- and are intentionally left untouched. Open Play already writes its own game rows
-- (tournament_id IS NOT NULL filters them out here).

-- (i) Insert game 1 for COMPLETED tournament matches that have no game row at all.
--     Draws (winner_id NULL) are real played games and are included.
INSERT INTO "MatchGame" (
  "id",
  "match_id",
  "game_number",
  "status",
  "winner_id",
  "player1_faction_id",
  "player2_faction_id",
  "played_at",
  "counts_for_leaderboard",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  m."id",
  1,
  'COMPLETED'::"MatchStatus",
  m."winner_id",
  m."player1_faction_id",
  m."player2_faction_id",
  COALESCE(m."played_at", m."updated_at"),
  m."counts_for_leaderboard",
  m."created_at",
  NOW()
FROM "Match" m
WHERE m."status" = 'COMPLETED'::"MatchStatus"
  AND m."deleted_at" IS NULL
  AND m."player1_id" IS NOT NULL
  AND m."player2_id" IS NOT NULL
  AND m."tournament_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "MatchGame" g WHERE g."match_id" = m."id");

-- (ii) Propagate match-level factions onto the game-1 row where the game has no
--      faction but the match does (e.g. games created from a map decision only).
UPDATE "MatchGame" mg
SET
  "player1_faction_id" = COALESCE(mg."player1_faction_id", m."player1_faction_id"),
  "player2_faction_id" = COALESCE(mg."player2_faction_id", m."player2_faction_id"),
  "updated_at" = NOW()
FROM "Match" m
WHERE mg."match_id" = m."id"
  AND mg."game_number" = 1
  AND mg."status" = 'COMPLETED'::"MatchStatus"
  AND m."deleted_at" IS NULL
  AND m."tournament_id" IS NOT NULL
  AND (m."player1_faction_id" IS NOT NULL OR m."player2_faction_id" IS NOT NULL)
  AND (mg."player1_faction_id" IS NULL OR mg."player2_faction_id" IS NULL);

-- NOTE: After deploy, run POST /api/admin/recompute-faction-stats once to rebuild
-- FactionStats + MatchupStats for the active season from the backfilled game rows.
