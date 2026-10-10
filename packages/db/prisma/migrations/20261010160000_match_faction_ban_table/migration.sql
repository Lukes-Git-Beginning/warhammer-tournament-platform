-- Faction bans move from MatchBlindPick into their own per-game table so modes without a blind
-- pick (3×3 Matrix) can use them too.
CREATE TABLE "MatchFactionBan" (
    "game_id" UUID NOT NULL,
    "player1_bans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "player2_bans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "player1_locked_at" TIMESTAMP(3),
    "player2_locked_at" TIMESTAMP(3),
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "MatchFactionBan_pkey" PRIMARY KEY ("game_id")
);

ALTER TABLE "MatchFactionBan" ADD CONSTRAINT "MatchFactionBan_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "MatchGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over any bans already made under 2.21.0.
INSERT INTO "MatchFactionBan" ("game_id", "player1_bans", "player2_bans", "player1_locked_at", "player2_locked_at", "revealed_at")
SELECT "game_id", "player1_bans", "player2_bans", "player1_bans_locked_at", "player2_bans_locked_at", "bans_revealed_at"
FROM "MatchBlindPick"
WHERE "player1_bans_locked_at" IS NOT NULL OR "player2_bans_locked_at" IS NOT NULL;

ALTER TABLE "MatchBlindPick" DROP COLUMN "player1_bans",
DROP COLUMN "player2_bans",
DROP COLUMN "player1_bans_locked_at",
DROP COLUMN "player2_bans_locked_at",
DROP COLUMN "bans_revealed_at";
