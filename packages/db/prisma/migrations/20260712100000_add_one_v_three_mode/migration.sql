-- 1v3 mode ("Set Faction vs. One of Three Counterpicks").
-- Additive: new TournamentMode enum value + host-set faction column. Prod-safe, no backfill.

ALTER TYPE "TournamentMode" ADD VALUE 'ONE_V_THREE';

ALTER TABLE "Tournament" ADD COLUMN "set_faction_id" TEXT;
