-- Cache-bust the Undead Legions crest. The icon was re-cut with a transparent
-- background (2.4.1), but the file kept its path, so Cloudflare kept serving the
-- old opaque copy from its edge cache (24h TTL, no purge step in the deploy).
-- Point the DB at a new path so the CDN treats it as a fresh object and fetches
-- the transparent crest from origin. Idempotent.
UPDATE "Faction"
SET "icon_url" = '/icons/factions/undead_legions_v2.png'
WHERE "id" = 'undead_legions';
