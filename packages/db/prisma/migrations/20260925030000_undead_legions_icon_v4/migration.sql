-- Repoint the Undead Legions crest to a fresh path (v4).
--
-- v2 and v3 were poisoned: the deploy that introduced each still ran the OLD
-- deploy.sh order (migrate BEFORE build — the reordered script only lands for the
-- NEXT deploy), so the file was missing when the DB started pointing at it, and
-- Cloudflare cached the SPA index.html fallback under the .png URL for 24h.
--
-- The reordered deploy.sh (build BEFORE migrate) is now live on the host, so this
-- v4 file is published before this migration references it. First request to v4
-- hits the real PNG → the CDN caches the image, not an HTML fallback. Idempotent.
UPDATE "Faction"
SET "icon_url" = '/icons/factions/undead_legions_v4.png'
WHERE "id" = 'undead_legions';
