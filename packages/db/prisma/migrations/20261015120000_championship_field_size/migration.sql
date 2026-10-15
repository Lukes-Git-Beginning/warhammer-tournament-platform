-- The planned field size of a championship final, frozen when its availability round opens.
ALTER TABLE "Tournament" ADD COLUMN "championship_field_size" INTEGER;

-- Backfill quarterly finals whose round is already open. A quarterly round invites every qualified
-- competitor and only opens at a Top 16 or more, so the frozen size is the power-of-two tier of half
-- the invite count (32+ invites -> Top 16, 64+ -> Top 32, ...). Ladder finals stay null: their size
-- comes from the closed month's standings, which no rule change moves.
UPDATE "Tournament" t
SET "championship_field_size" = CASE
    WHEN n.invites >= 256 THEN 128
    WHEN n.invites >= 128 THEN 64
    WHEN n.invites >= 64 THEN 32
    WHEN n.invites >= 32 THEN 16
    ELSE NULL
  END
FROM (SELECT "tournament_id", COUNT(*) AS invites FROM "ChampionshipInvite" GROUP BY "tournament_id") n
WHERE n."tournament_id" = t."id"
  AND t."championship_kind" = 'QUARTERLY'
  AND t."availability_opened_at" IS NOT NULL;
