-- Rename the launch season to the game-version scheme now that versions manage the meta axis.
-- Cosmetic (name only): games are tagged by id (season_id / version_id), so nothing is reassigned,
-- and the runtime (start_date / end_date) is left untouched. Targets the exact prod value, so it is
-- a no-op on any environment without a "Season 2026" row. The physical table is still "Season"
-- (GameVersion @@map("Season")).
UPDATE "Season" SET name = '8.1' WHERE name = 'Season 2026';
