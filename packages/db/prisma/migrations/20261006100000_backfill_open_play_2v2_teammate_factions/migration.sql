-- Open Play 2v2 games never persisted the teammate's faction on the game row: the revealed blind pick
-- held both factions per side, but game finalisation copied only the captain's. Copy the teammate
-- factions (positional: *_faction_id_2) from the revealed blind pick onto games and mirror game 1 onto
-- the match. Idempotent: only NULL targets are filled, so re-running changes nothing.
-- FactionStats/MatchupStats do not read the _2 columns (1v1 meta) and duo-meta is derived on read,
-- so no stats recompute is required.

UPDATE "MatchGame" g
SET
  "player1_faction_id_2" = COALESCE(g."player1_faction_id_2", bp."player1_faction_id_2"),
  "player2_faction_id_2" = COALESCE(g."player2_faction_id_2", bp."player2_faction_id_2")
FROM "MatchBlindPick" bp, "Match" m
WHERE bp."game_id" = g."id"
  AND m."id" = g."match_id"
  AND m."type" = 'OPEN_PLAY'
  AND m."competitor_format" = 'TWO_V_TWO'
  AND bp."revealed_at" IS NOT NULL
  AND ((g."player1_faction_id_2" IS NULL AND bp."player1_faction_id_2" IS NOT NULL)
    OR (g."player2_faction_id_2" IS NULL AND bp."player2_faction_id_2" IS NOT NULL));

UPDATE "Match" m
SET
  "player1_faction_id_2" = COALESCE(m."player1_faction_id_2", g."player1_faction_id_2"),
  "player2_faction_id_2" = COALESCE(m."player2_faction_id_2", g."player2_faction_id_2")
FROM "MatchGame" g
WHERE g."match_id" = m."id"
  AND g."game_number" = 1
  AND m."type" = 'OPEN_PLAY'
  AND m."competitor_format" = 'TWO_V_TWO'
  AND ((m."player1_faction_id_2" IS NULL AND g."player1_faction_id_2" IS NOT NULL)
    OR (m."player2_faction_id_2" IS NULL AND g."player2_faction_id_2" IS NOT NULL));
