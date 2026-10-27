-- New queue/notify preference rows default to every battle type, Domquest included.
ALTER TABLE "UserQueuePref" ALTER COLUMN "battle_types" SET DEFAULT ARRAY['DOMINATION', 'DOMQUEST', 'CONQUEST', 'LAND_BATTLE', 'SIEGE']::"BattleType"[];
ALTER TABLE "UserTournamentNotifyPref" ALTER COLUMN "battle_types" SET DEFAULT ARRAY['DOMINATION', 'DOMQUEST', 'CONQUEST', 'LAND_BATTLE', 'SIEGE']::"BattleType"[];

-- Players who had every battle type ticked get Domquest too; a deliberately narrowed choice stays as it is.
UPDATE "UserQueuePref" SET "battle_types" = array_append("battle_types", 'DOMQUEST'::"BattleType")
WHERE "battle_types" @> ARRAY['DOMINATION', 'CONQUEST', 'LAND_BATTLE', 'SIEGE']::"BattleType"[]
  AND NOT ('DOMQUEST'::"BattleType" = ANY ("battle_types"));
UPDATE "UserTournamentNotifyPref" SET "battle_types" = array_append("battle_types", 'DOMQUEST'::"BattleType")
WHERE "battle_types" @> ARRAY['DOMINATION', 'CONQUEST', 'LAND_BATTLE', 'SIEGE']::"BattleType"[]
  AND NOT ('DOMQUEST'::"BattleType" = ANY ("battle_types"));

-- The Domquest map pool: RizzOtto's Arena Mod builds a Domquest version of every map in this pool. It starts
-- as a copy of the Domination maps that are available at release (each its own row, slug suffix -domquest,
-- same image). Admins edit it in the map pool like any other.
INSERT INTO "Map" ("id", "slug", "name", "description", "image_url", "battle_type", "available", "created_at", "updated_at")
SELECT gen_random_uuid()::text, m."slug" || '-domquest', m."name", m."description", m."image_url", 'DOMQUEST'::"BattleType", true, now(), now()
FROM "Map" m
WHERE m."battle_type" = 'DOMINATION' AND m."available" = true AND m."deleted_at" IS NULL
ON CONFLICT ("slug") DO NOTHING;

-- Standard Ruleset: Domquest starts as a copy of Domination (both team sizes, so the same bans and conduct)
-- with the settings the mod fixes for Domquest. Only where an admin-edited Domination ruleset exists and
-- Domquest has none yet; otherwise the code defaults apply (defaultRulesetFor). Admins edit it further.
UPDATE "AdminConfig" c
SET "value" = c."value" || jsonb_build_object(
      'DOMQUEST:ONE_V_ONE',
      jsonb_set(c."value"->'DOMINATION:ONE_V_ONE', '{settings}',
        '["Starting Army 12,400", "Reinforcing Army up to 5,600", "Ultra Unit Scale", "Unit Caps On", "No Character Loading", "600 Tickets"]'::jsonb),
      'DOMQUEST:TWO_V_TWO',
      jsonb_set(c."value"->'DOMINATION:TWO_V_TWO', '{settings}',
        '["Starting Army 12,400", "Reinforcing Army up to 5,600", "Ultra Unit Scale", "Unit Caps On", "No Character Loading", "600 Tickets"]'::jsonb)
    ),
    "updated_at" = now()
WHERE c."key" = 'standard_ruleset'
  AND jsonb_typeof(c."value") = 'object'
  AND c."value" ? 'DOMINATION:ONE_V_ONE'
  AND c."value" ? 'DOMINATION:TWO_V_TWO'
  AND NOT c."value" ? 'DOMQUEST:ONE_V_ONE';
