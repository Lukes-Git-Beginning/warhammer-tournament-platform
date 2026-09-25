-- Repoint the Undead Legions crest to a fresh path (v5).
--
-- Earlier paths were poisoned: the CDN cached Caddy's SPA index.html fallback under
-- the .png URL whenever the file was requested before it existed (v2/v3 during the
-- old migrate-before-build deploy window; v4 by a stray diagnostic request).
--
-- The reordered deploy.sh (build BEFORE migrate) is live on the host, so v5 is
-- published before this migration references it, and NOTHING requests the v5 URL
-- until then — so the CDN's first hit is the real PNG. Idempotent.
UPDATE "Faction"
SET "icon_url" = '/icons/factions/undead_legions_v5.png'
WHERE "id" = 'undead_legions';
