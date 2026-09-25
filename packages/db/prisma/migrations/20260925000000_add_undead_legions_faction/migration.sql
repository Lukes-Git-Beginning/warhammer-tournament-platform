-- Add the 25th faction: Undead Legions (Host of Nagash, "Lords of the End Times" DLC).
-- Data-only migration; idempotent (ON CONFLICT) so a re-run or a seed overlap is safe.
-- The icon lives at apps/frontend/public/icons/factions/undead_legions.png.
INSERT INTO "Faction" ("id", "name", "race", "category", "color_hex", "display_order", "icon_url")
VALUES ('undead_legions', 'Undead Legions', 'Undead', 'UNDEAD'::"FactionCategory", '#4B2E5E', 25, '/icons/factions/undead_legions.png')
ON CONFLICT ("id") DO NOTHING;
