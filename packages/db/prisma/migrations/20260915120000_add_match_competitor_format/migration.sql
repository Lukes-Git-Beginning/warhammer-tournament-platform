-- Team size per MATCH (independent of a tournament — Open-Play 2v2 has no tournament).
-- Drives isTeam across the shared play/report flow.

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "competitor_format" "CompetitorFormat" NOT NULL DEFAULT 'ONE_V_ONE';

-- Backfill existing matches from their owning tournament's competitor_format.
UPDATE "Match" m
SET "competitor_format" = t."competitor_format"
FROM "Tournament" t
WHERE m."tournament_id" = t."id";
