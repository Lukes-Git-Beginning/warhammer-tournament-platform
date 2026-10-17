-- New queue/notify preference rows default to every battle type, Land Battle included.
ALTER TABLE "UserQueuePref" ALTER COLUMN "battle_types" SET DEFAULT ARRAY['DOMINATION', 'CONQUEST', 'LAND_BATTLE', 'SIEGE']::"BattleType"[];
ALTER TABLE "UserTournamentNotifyPref" ALTER COLUMN "battle_types" SET DEFAULT ARRAY['DOMINATION', 'CONQUEST', 'LAND_BATTLE', 'SIEGE']::"BattleType"[];

-- Players who had every battle type ticked get Land Battle too; a deliberately narrowed choice stays as it is.
UPDATE "UserQueuePref" SET "battle_types" = array_append("battle_types", 'LAND_BATTLE'::"BattleType")
WHERE "battle_types" @> ARRAY['DOMINATION', 'CONQUEST', 'SIEGE']::"BattleType"[]
  AND NOT ('LAND_BATTLE'::"BattleType" = ANY ("battle_types"));
UPDATE "UserTournamentNotifyPref" SET "battle_types" = array_append("battle_types", 'LAND_BATTLE'::"BattleType")
WHERE "battle_types" @> ARRAY['DOMINATION', 'CONQUEST', 'SIEGE']::"BattleType"[]
  AND NOT ('LAND_BATTLE'::"BattleType" = ANY ("battle_types"));

-- The Land Battle map pool (34 maps, collected by Humanboy). A map belongs to exactly one battle type, so
-- the maps Conquest already has get their own Land Battle rows (slug suffix -land-battle). The images ship
-- with the frontend build under a new path (/maps/land-battle/), so image_url points straight at them.
INSERT INTO "Map" ("id", "slug", "name", "image_url", "battle_type", "available", "created_at", "updated_at") VALUES
  ('887ecaba-b698-4053-968e-3e4f89d0c294', 'alpine-ridge-land-battle', 'Alpine Ridge', '/maps/land-battle/alpine-ridge.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('40a0d3da-3f5a-4a56-91d1-de00cd7c8b01', 'ash-plains-land-battle', 'Ash Plains', '/maps/land-battle/ash-plains.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('e54667ac-6a0f-4ddc-aa00-9992895cbcda', 'bloodpine-woods-land-battle', 'Bloodpine Woods', '/maps/land-battle/bloodpine-woods.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('4ad9fbca-e75b-4daa-acb3-2d3983bada4e', 'cliff-of-beasts-land-battle', 'Cliff of Beasts', '/maps/land-battle/cliff-of-beasts.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('0ac527ee-5909-4390-9f47-be8ae789fd9a', 'da-stompin-groundz-land-battle', 'Da Stompin Groundz', '/maps/land-battle/da-stompin-groundz.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('93b2ba4f-61ad-406c-8946-2cd9d7671448', 'dok-karaz-land-battle', 'Dok Karaz', '/maps/land-battle/dok-karaz.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('2bca4e21-cd02-4be1-8dc1-6f504e398418', 'eschen-land-battle', 'Eschen', '/maps/land-battle/eschen.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('bc442abe-7466-46e3-a274-bd71d0e0f879', 'galbaraz-land-battle', 'Galbaraz', '/maps/land-battle/galbaraz.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('29b07de3-e26e-4548-8960-62dc63b3b33b', 'gor-gazan-land-battle', 'Gor Gazan', '/maps/land-battle/gor-gazan.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('8ec51893-947f-4e73-9213-3b4da1c90633', 'grey-mountain-stables-land-battle', 'Grey Mountain Stables', '/maps/land-battle/grey-mountain-stables.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('acbe4022-8ed9-4003-b8e9-a13dd04b6acb', 'knights-run-land-battle', 'Knights Run', '/maps/land-battle/knights-run.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('4c49fed9-ba47-4818-aa3d-e5e49c4c490c', 'mortis-wastes-land-battle', 'Mortis Wastes', '/maps/land-battle/mortis-wastes.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('8602d5ca-31d5-4a8e-9fe1-539d67b94112', 'peak-pass-land-battle', 'Peak Pass', '/maps/land-battle/peak-pass.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('322cb064-bb38-4979-b61d-cfbd708b616d', 'peasants-pasture-land-battle', 'Peasants Pasture', '/maps/land-battle/peasants-pasture.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('5bfe6ae0-f4ae-4647-bbe9-253709fc7d27', 'pillar-of-bone-land-battle', 'Pillar of Bone', '/maps/land-battle/pillar-of-bone.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('9d3e4461-2465-480a-9f14-ab96a40958d0', 'plain-of-spiders-land-battle', 'Plain of Spiders', '/maps/land-battle/plain-of-spiders.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('94bcc4a0-9e0c-4774-9c3c-f007bf4c5b2a', 'praag-land-battle', 'Praag', '/maps/land-battle/praag.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('dbc4bb21-c1a9-459c-a7b9-8547b86eeeb4', 'river-amaxon-land-battle', 'River Amaxon', '/maps/land-battle/river-amaxon.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('a38c758e-c855-46a3-b539-4bc17d8f3948', 'schwartzhafen-land-battle', 'Schwartzhafen', '/maps/land-battle/schwartzhafen.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('e322912d-0866-41ea-89d8-2bf4cf5d66a2', 'shagrath-strand-land-battle', 'Shagrath Strand', '/maps/land-battle/shagrath-strand.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('b0d74635-534e-4f1b-a4f4-cd7a1d8db3ce', 'shimmersward-land-battle', 'Shimmersward', '/maps/land-battle/shimmersward.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('a5514402-afca-43ef-a168-59bb3e964277', 'southern-chaos-wastes-land-battle', 'Southern Chaos Wastes', '/maps/land-battle/southern-chaos-wastes.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('1bca9a9b-38b1-4fc2-9742-914344a073df', 'spice-dunes-land-battle', 'Spice Dunes', '/maps/land-battle/spice-dunes.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('79360c4c-aca9-4af4-9c8c-143ed2065e65', 'sword-of-torgald-land-battle', 'Sword of Torgald', '/maps/land-battle/sword-of-torgald.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('23c804bd-2454-43ce-b511-b0d98cff9048', 'the-bitter-dunes-land-battle', 'The Bitter Dunes', '/maps/land-battle/the-bitter-dunes.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('34fa3e81-fa91-4386-aea7-d791ba8c632e', 'the-chill-flow-land-battle', 'The Chill Flow', '/maps/land-battle/the-chill-flow.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('634a8bd5-8d73-414c-8dde-a145927a7c89', 'the-deserts-bounty-land-battle', 'The Deserts Bounty', '/maps/land-battle/the-deserts-bounty.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('80fb7091-f82b-458a-bd85-7bf1e5f41144', 'the-flats-of-kislev-land-battle', 'The Flats of Kislev', '/maps/land-battle/the-flats-of-kislev.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('0733ea0d-1345-499e-81fa-5430897ddbc0', 'the-lost-crater-land-battle', 'The Lost Crater', '/maps/land-battle/the-lost-crater.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('fcbdb23a-a3df-4c72-b2cd-228746fb0ac9', 'the-reikland-estates-land-battle', 'The Reikland Estates', '/maps/land-battle/the-reikland-estates.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('293310e7-eedc-4ef2-8589-ddaf1ce766b6', 'the-tourney-grounds-land-battle', 'The Tourney Grounds', '/maps/land-battle/the-tourney-grounds.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('ae2a775d-c958-44a5-a1ef-e3698886d2a8', 'tower-of-hoeth-land-battle', 'Tower of Hoeth', '/maps/land-battle/tower-of-hoeth.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('95969816-ff9a-4e14-a36d-f1e1c4e57be3', 'valley-of-thieves-land-battle', 'Valley of Thieves', '/maps/land-battle/valley-of-thieves.png', 'LAND_BATTLE'::"BattleType", true, now(), now()),
  ('b4327f2e-928c-4857-8831-9f16b46a8f85', 'vulture-ridge-land-battle', 'Vulture Ridge', '/maps/land-battle/vulture-ridge.png', 'LAND_BATTLE'::"BattleType", true, now(), now())
ON CONFLICT ("slug") DO NOTHING;

-- Standard Ruleset: Land Battle starts as a copy of Conquest (both team sizes) without its ticket count —
-- a land battle has no tickets. Only where an admin-edited Conquest ruleset exists and Land Battle has none
-- yet; otherwise the code defaults apply. Admins edit it further in the ruleset editor.
UPDATE "AdminConfig" c
SET "value" = c."value" || jsonb_build_object(
      'LAND_BATTLE:ONE_V_ONE',
      jsonb_set(c."value"->'CONQUEST:ONE_V_ONE', '{settings}', COALESCE(
        (SELECT jsonb_agg(s) FROM jsonb_array_elements(c."value"->'CONQUEST:ONE_V_ONE'->'settings') s WHERE s #>> '{}' NOT ILIKE '%ticket%'),
        '[]'::jsonb)),
      'LAND_BATTLE:TWO_V_TWO',
      jsonb_set(c."value"->'CONQUEST:TWO_V_TWO', '{settings}', COALESCE(
        (SELECT jsonb_agg(s) FROM jsonb_array_elements(c."value"->'CONQUEST:TWO_V_TWO'->'settings') s WHERE s #>> '{}' NOT ILIKE '%ticket%'),
        '[]'::jsonb))
    ),
    "updated_at" = now()
WHERE c."key" = 'standard_ruleset'
  AND jsonb_typeof(c."value") = 'object'
  AND c."value" ? 'CONQUEST:ONE_V_ONE'
  AND c."value" ? 'CONQUEST:TWO_V_TWO'
  AND NOT c."value" ? 'LAND_BATTLE:ONE_V_ONE';
