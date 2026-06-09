-- Remove four duplicate map records created when the seed was re-run after
-- admin corrections changed the name without updating the slug.
-- The correct records (matching the current seed) are kept.
UPDATE "Map"
SET deleted_at = NOW()
WHERE slug IN (
  'glades-of-the-everqueen',
  'itza',
  'rift-at-worlds-edge',
  'skjlanadirs-cave'
)
AND deleted_at IS NULL;
