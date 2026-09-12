-- Map: one battle type per map (not a list) + an `available` host/Open-Play toggle.
-- Backfill battle_type from the first element of the old array; treat currently-active
-- (non-deleted) maps as available, soft-deleted ones as unavailable.

ALTER TABLE "Map" ADD COLUMN "battle_type" "BattleType" NOT NULL DEFAULT 'DOMINATION';
ALTER TABLE "Map" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Map"
SET "battle_type" = "battle_types"[1]
WHERE array_length("battle_types", 1) >= 1;

UPDATE "Map" SET "available" = ("deleted_at" IS NULL);

ALTER TABLE "Map" DROP COLUMN "battle_types";

CREATE INDEX "Map_battle_type_idx" ON "Map"("battle_type");
