-- Blind Pick faction bans: per-game bans before the blind pick (host sets 0–2 per player).
ALTER TABLE "Tournament" ADD COLUMN "faction_bans_per_player" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MatchBlindPick" ADD COLUMN "player1_bans" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "player2_bans" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "player1_bans_locked_at" TIMESTAMP(3),
ADD COLUMN "player2_bans_locked_at" TIMESTAMP(3),
ADD COLUMN "bans_revealed_at" TIMESTAMP(3);
