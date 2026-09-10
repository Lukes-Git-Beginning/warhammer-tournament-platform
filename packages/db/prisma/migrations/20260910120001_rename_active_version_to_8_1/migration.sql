-- Rename the live Game Version instance from the old "Season 2026" label to the
-- meaningful game version number "8.1" (name + dlc_tag). Guarded + idempotent:
-- touches only the active version, and only while it still carries the old name,
-- so re-running (or a prod instance already renamed) is a safe no-op.
UPDATE "Season"
SET "name" = '8.1', "dlc_tag" = '8.1'
WHERE "is_active" = true AND "name" = 'Season 2026';
