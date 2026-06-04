-- ============================================================
-- M7: Introduce MatchGame as the intermediate entity between
--     Match and its per-game data (MatchMapDecision, MatchBlindPick).
--
-- Motivation:
--   The existing 1:1 Match → MatchMapDecision/MatchBlindPick schema
--   cannot support Bo3/Bo5 series (multiple games per match).
--   MatchGame becomes the canonical metadata carrier: map, factions,
--   winner, replay, lobby-code, provisional-result timestamps.
--
-- v1 scope: always game_number=1 (Bo1 only).
--           Bo3/Bo5 enabled by adding more MatchGame rows.
--
-- Backfill: one MatchGame (game_number=1) per existing Match that
--           already has a MatchMapDecision OR MatchBlindPick row.
-- ============================================================

-- ============================================================
-- Step 1: Create MatchGame table
-- ============================================================
CREATE TABLE "MatchGame" (
    "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    "match_id"           UUID         NOT NULL,
    "game_number"        INTEGER      NOT NULL DEFAULT 1,
    "status"             "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "winner_id"          UUID,
    "player1_faction_id" TEXT,
    "player2_faction_id" TEXT,
    "lobby_code"         TEXT,
    "reported_winner_id" UUID,
    "reporter_id"        UUID,
    "reported_at"        TIMESTAMP(3),
    "confirmed_at"       TIMESTAMP(3),
    "replay_url"         TEXT,
    "played_at"          TIMESTAMP(3),
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchGame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchGame_match_id_game_number_key" ON "MatchGame"("match_id", "game_number");
CREATE INDEX "MatchGame_match_id_idx" ON "MatchGame"("match_id");
CREATE INDEX "MatchGame_reported_at_idx" ON "MatchGame"("reported_at");

ALTER TABLE "MatchGame"
    ADD CONSTRAINT "MatchGame_match_id_fkey"
    FOREIGN KEY ("match_id") REFERENCES "Match"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Step 2: Backfill — one MatchGame per existing Match that has
--         at least one Decision or BlindPick row.
--         UNION (without ALL) deduplicates: a Match with both
--         gets exactly one MatchGame.
-- ============================================================
INSERT INTO "MatchGame" ("id", "match_id", "game_number", "status", "updated_at")
SELECT
    gen_random_uuid(),
    existing_matches.match_id,
    1,
    'PENDING',
    CURRENT_TIMESTAMP
FROM (
    SELECT match_id FROM "MatchMapDecision"
    UNION
    SELECT match_id FROM "MatchBlindPick"
) AS existing_matches;

-- ============================================================
-- Step 3: Add game_id columns (nullable first for backfill)
-- ============================================================
ALTER TABLE "MatchMapDecision" ADD COLUMN "game_id" UUID;
ALTER TABLE "MatchBlindPick"   ADD COLUMN "game_id" UUID;

-- ============================================================
-- Step 4: Backfill game_id from the newly created MatchGame rows
-- ============================================================
UPDATE "MatchMapDecision" d
SET "game_id" = g."id"
FROM "MatchGame" g
WHERE g."match_id" = d."match_id"
  AND g."game_number" = 1;

UPDATE "MatchBlindPick" b
SET "game_id" = g."id"
FROM "MatchGame" g
WHERE g."match_id" = b."match_id"
  AND g."game_number" = 1;

-- ============================================================
-- Step 5: Make game_id NOT NULL after clean backfill
-- ============================================================
ALTER TABLE "MatchMapDecision" ALTER COLUMN "game_id" SET NOT NULL;
ALTER TABLE "MatchBlindPick"   ALTER COLUMN "game_id" SET NOT NULL;

-- ============================================================
-- Step 6: Pivot PKs — drop old match_id PK, set game_id as new PK
-- ============================================================

-- Drop redundant indexes (were redundant on the @id anyway)
DROP INDEX IF EXISTS "MatchMapDecision_match_id_idx";
DROP INDEX IF EXISTS "MatchBlindPick_match_id_idx";

-- Drop old FK constraints on match_id
ALTER TABLE "MatchMapDecision" DROP CONSTRAINT "MatchMapDecision_match_id_fkey";
ALTER TABLE "MatchBlindPick"   DROP CONSTRAINT "MatchBlindPick_match_id_fkey";

-- Drop old PKs
ALTER TABLE "MatchMapDecision" DROP CONSTRAINT "MatchMapDecision_pkey";
ALTER TABLE "MatchBlindPick"   DROP CONSTRAINT "MatchBlindPick_pkey";

-- Set game_id as new PK (enforces 1:1 relationship to MatchGame)
ALTER TABLE "MatchMapDecision" ADD CONSTRAINT "MatchMapDecision_pkey" PRIMARY KEY ("game_id");
ALTER TABLE "MatchBlindPick"   ADD CONSTRAINT "MatchBlindPick_pkey"   PRIMARY KEY ("game_id");

-- Add FK constraints from game_id → MatchGame.id (Cascade)
ALTER TABLE "MatchMapDecision"
    ADD CONSTRAINT "MatchMapDecision_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "MatchGame"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchBlindPick"
    ADD CONSTRAINT "MatchBlindPick_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "MatchGame"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Step 7: Drop old match_id and game_index columns
-- ============================================================
ALTER TABLE "MatchMapDecision" DROP COLUMN "match_id";
ALTER TABLE "MatchMapDecision" DROP COLUMN "game_index";

ALTER TABLE "MatchBlindPick"   DROP COLUMN "match_id";
ALTER TABLE "MatchBlindPick"   DROP COLUMN "game_index";

-- ============================================================
-- Step 8: Bo1-normalization — set all existing tournament
--         match formats to BO1 (test data only, no production rows).
-- ============================================================
UPDATE "Tournament"
SET "playoff_match_format" = 'BO1',
    "finale_match_format"  = 'BO1'
WHERE "playoff_match_format" != 'BO1'
   OR "finale_match_format"  != 'BO1';
