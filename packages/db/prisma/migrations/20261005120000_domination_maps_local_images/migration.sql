-- Domination maps: move images off Imgur onto the self-hosted files and bring back the full set.
-- The deploy runs migrations but NOT the seed (which already had local paths + the full list),
-- so prod still pointed at Imgur and lacked the maps dropped in June (939c873).
-- The files ship with the frontend build under /maps/ (since ba341a3), and the deploy publishes the
-- build before migrating, so every path below exists before the DB points at it.

-- 1) Re-point the live Domination maps from Imgur to the local copy, matched by the exact Imgur
--    source URL each file was downloaded from (slug-independent: 3 prod slugs differ from the data).
UPDATE "Map" SET "image_url" = '/maps/altar-of-the-champion.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/yz5oLma.jpeg';
UPDATE "Map" SET "image_url" = '/maps/aracknarock-lair.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/saz9JBu.jpeg';
UPDATE "Map" SET "image_url" = '/maps/bleakspire-labour-camp.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/Ej0FME2.jpeg';
UPDATE "Map" SET "image_url" = '/maps/bordeleaux-landing.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/Cyp0j7l.jpeg';
UPDATE "Map" SET "image_url" = '/maps/bray-valley.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/XJrDm83.jpeg';
UPDATE "Map" SET "image_url" = '/maps/celestial-lake.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/JlWAhw7.jpeg';
UPDATE "Map" SET "image_url" = '/maps/chateau-de-roquefort.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/QKZ8pt5.jpeg';
UPDATE "Map" SET "image_url" = '/maps/creeping-swamp.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/oTLPL1o.jpeg';
UPDATE "Map" SET "image_url" = '/maps/crystal-lake.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/bcIE6QL.jpeg';
UPDATE "Map" SET "image_url" = '/maps/decrepit-moor.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/tdr9OGl.jpeg';
UPDATE "Map" SET "image_url" = '/maps/dried-floodplain.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/jbwS3io.jpeg';
UPDATE "Map" SET "image_url" = '/maps/dunes-of-khaine.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/Cw07uU3.jpeg';
UPDATE "Map" SET "image_url" = '/maps/dustbowl.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/fbeT1cA.jpeg';
UPDATE "Map" SET "image_url" = '/maps/eastern-isle-colony.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/XlbRBLa.jpeg';
UPDATE "Map" SET "image_url" = '/maps/edge-of-the-darkwood.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/TNMw7j1.jpeg';
UPDATE "Map" SET "image_url" = '/maps/glade-of-the-everqueen.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/LC6uWJ3.jpeg';
UPDATE "Map" SET "image_url" = '/maps/glinty-toofs-crag.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/5wPEGhT.jpeg';
UPDATE "Map" SET "image_url" = '/maps/hashuts-oilfields.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/3cNieCe.jpeg';
UPDATE "Map" SET "image_url" = '/maps/haunted-vale.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/0VnWsIb.jpeg';
UPDATE "Map" SET "image_url" = '/maps/imperial-ambush.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/aFXp5qw.jpeg';
UPDATE "Map" SET "image_url" = '/maps/imperial-road.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/wiMbaFw.jpeg';
UPDATE "Map" SET "image_url" = '/maps/jade-tomb.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/x7PC3mz.jpeg';
UPDATE "Map" SET "image_url" = '/maps/khsars-cursed-oasis.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/0vLF5DV.jpeg';
UPDATE "Map" SET "image_url" = '/maps/lost-temple-of-sotek.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/UpMzR5h.jpeg';
UPDATE "Map" SET "image_url" = '/maps/norscan-rise.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/olAbf3U.jpeg';
UPDATE "Map" SET "image_url" = '/maps/proving-grounds.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/dngqsiC.jpeg';
UPDATE "Map" SET "image_url" = '/maps/putrefying-carcass.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/XZ32CD1.jpeg';
UPDATE "Map" SET "image_url" = '/maps/rapturous-expanse.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/jU112ja.jpeg';
UPDATE "Map" SET "image_url" = '/maps/rift-at-the-worlds-edge.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/USxlGQx.jpeg';
UPDATE "Map" SET "image_url" = '/maps/road-to-talabheim.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/c7xXQvx.jpeg';
UPDATE "Map" SET "image_url" = '/maps/skjalandirs-cave.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/NtZ1Rxn.jpeg';
UPDATE "Map" SET "image_url" = '/maps/the-blazing-ramparts.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/V7uKLph.jpeg';
UPDATE "Map" SET "image_url" = '/maps/the-blood-grove.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/Ju2vMRf.jpeg';
UPDATE "Map" SET "image_url" = '/maps/the-changers-madhouse.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/2QJZe1V.jpeg';
UPDATE "Map" SET "image_url" = '/maps/whirling-maelstrom.jpeg', "updated_at" = now() WHERE "image_url" = 'https://i.imgur.com/VvrCxyx.jpeg';

-- 2) The other Domination maps: insert (or restore a June soft-delete) with the local image.
--    Only Otsuchi Castle, Blasphemous Snowfield and Excavation Site become available; the rest stay
--    switched off (Admin > Map Pool can enable them). A row that is already live keeps the admin's choice.
INSERT INTO "Map" ("id", "slug", "name", "image_url", "battle_type", "available", "created_at", "updated_at") VALUES
  (gen_random_uuid()::text, 'altar-of-hashut', 'Altar of Hashut', '/maps/altar-of-hashut.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'altdorf-farmlands', 'Altdorf Farmlands', '/maps/altdorf-farmlands.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'arbiters-ground', 'Arbiter''s Ground', '/maps/arbiters-ground.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'battered-bluff', 'Battered Bluff', '/maps/battered-bluff.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'blasphemous-snowfield', 'Blasphemous Snowfield', '/maps/blasphemous-snowfield.png', 'DOMINATION'::"BattleType", true, now(), now()),
  (gen_random_uuid()::text, 'blighted-marsh', 'Blighted Marsh', '/maps/blighted-marsh.png', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'clash-of-chaos', 'Clash of Chaos', '/maps/clash-of-chaos.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'coedills-mistwood', 'Coedill''s Mistwood', '/maps/coedills-mistwood.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'crater-of-decay', 'Crater of Decay', '/maps/crater-of-decay.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'dunes-of-setep', 'Dunes of Setep', '/maps/dunes-of-setep.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'dusted-steppe', 'Dusted Steppe', '/maps/dusted-steppe.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'excavation-site', 'Excavation Site', '/maps/excavation-site.jpeg', 'DOMINATION'::"BattleType", true, now(), now()),
  (gen_random_uuid()::text, 'gates-of-ekrund', 'Gates of Ekrund', '/maps/gates-of-ekrund.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'geothermal-crevice', 'Geothermal Crevice', '/maps/geothermal-crevice.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'geyser-bluff', 'Geyser Bluff', '/maps/geyser-bluff.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'graveyard-of-altdorf', 'Graveyard of Altdorf', '/maps/graveyard-of-altdorf.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'halls-of-karag-dum', 'Halls of Karag Dum', '/maps/halls-of-karag-dum.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'hell-pit-depths', 'Hell Pit Depths', '/maps/hell-pit-depths.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'isle-of-forgotten-kings', 'Isle of Forgotten Kings', '/maps/isle-of-forgotten-kings.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'lost-isles-of-culchan', 'Lost Isles of Culchan', '/maps/lost-isles-of-culchan.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'lustrian-narrows', 'Lustrian Narrows', '/maps/lustrian-narrows.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'mercenaries-of-tilea', 'Mercenaries of Tilea', '/maps/mercenaries-of-tilea.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'needlemyst-isle', 'Needlemyst Isle', '/maps/needlemyst-isle.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'nehekharan-wastes', 'Nehekharan Wastes', '/maps/nehekharan-wastes.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'nuln-outskirts', 'Nuln Outskirts', '/maps/nuln-outskirts.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'oakenshield', 'Oakenshield', '/maps/oakenshield.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'oasis-of-zedri', 'Oasis of Zedri', '/maps/oasis-of-zedri.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'otsuchi-castle', 'Otsuchi Castle', '/maps/otsuchi-castle.jpeg', 'DOMINATION'::"BattleType", true, now(), now()),
  (gen_random_uuid()::text, 'pit-of-the-everchosen', 'Pit of the Everchosen', '/maps/pit-of-the-everchosen.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'pit-of-treasures', 'Pit of Treasures', '/maps/pit-of-treasures.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'road-to-vauls-anvil', 'Road to Vaul''s Anvil', '/maps/road-to-vauls-anvil.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'ruins-of-arrogance', 'Ruins of Arrogance', '/maps/ruins-of-arrogance.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'sacred-cenote-of-chaqua', 'Sacred Cenote of Chaqua', '/maps/sacred-cenote-of-chaqua.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'shambling-bog', 'Shambling Bog', '/maps/shambling-bog.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'siege-of-salernum', 'Siege of Salernum', '/maps/siege-of-salernum.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'stoneenge', 'Stone''enge', '/maps/stoneenge.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'sunken-mire', 'Sunken Mire', '/maps/sunken-mire.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'talabheim-crater', 'Talabheim Crater', '/maps/talabheim-crater.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'temple-of-usirian', 'Temple of Usirian', '/maps/temple-of-usirian.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'terracotta-graveyard', 'Terracotta Graveyard', '/maps/terracotta-graveyard.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-arena', 'The Arena', '/maps/the-arena.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-crucible', 'The Crucible', '/maps/the-crucible.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-hags-conclave', 'The Hag''s Conclave', '/maps/the-hags-conclave.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-mountain-of-truth', 'The Mountain of Truth', '/maps/the-mountain-of-truth.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-sword-of-the-lake', 'The Sword of the Lake', '/maps/the-sword-of-the-lake.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-valley-of-lies', 'The Valley of Lies', '/maps/the-valley-of-lies.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'the-vanishing-steppe', 'The Vanishing Steppe', '/maps/the-vanishing-steppe.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'twilight-forest', 'Twilight Forest', '/maps/twilight-forest.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'urgots-stompin-groundz', 'Urgot''s Stompin Groundz', '/maps/urgots-stompin-groundz.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'vineyards-of-varieno', 'Vineyards of Varieno', '/maps/vineyards-of-varieno.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'womb-of-sorrow', 'Womb of Sorrow', '/maps/womb-of-sorrow.jpeg', 'DOMINATION'::"BattleType", false, now(), now()),
  (gen_random_uuid()::text, 'zharr-naggrund-rebellion', 'Zharr-Naggrund Rebellion', '/maps/zharr-naggrund-rebellion.jpeg', 'DOMINATION'::"BattleType", false, now(), now())
ON CONFLICT ("slug") DO UPDATE SET
  "image_url" = EXCLUDED."image_url",
  "battle_type" = EXCLUDED."battle_type",
  "available" = CASE
    WHEN EXCLUDED."available" THEN true
    WHEN "Map"."deleted_at" IS NULL THEN "Map"."available"
    ELSE false
  END,
  "deleted_at" = NULL,
  "updated_at" = now();
