-- Repoint the Undead Legions crest to a fresh, never-requested path (v3).
--
-- v2 got poisoned: the deploy applied the icon_url migration BEFORE the frontend
-- build published the file, so requests for the not-yet-served path fell through
-- Caddy's SPA fallback to index.html (200) and Cloudflare cached that HTML under
-- the .png URL for 24h. deploy.sh now builds (publishes files) BEFORE running
-- migrations, so this v3 path is already served by the time the DB points at it —
-- the CDN caches the real PNG, not an HTML fallback. Idempotent.
UPDATE "Faction"
SET "icon_url" = '/icons/factions/undead_legions_v3.png'
WHERE "id" = 'undead_legions';
