-- Open Play is bound by the Standard Ruleset (Alex, 2026-10-07) and Undead Legions must not be
-- pickable there: add the faction id to banned_factions of every stored (battle type x team size)
-- combo. Only touches the per-combo map shape (every value an object); idempotent (no duplicate);
-- a legacy single-ruleset value or a missing row is left alone (the code defaults apply then).
UPDATE "AdminConfig" c
SET "value" = (
  SELECT jsonb_object_agg(
    e.key,
    e.value || jsonb_build_object(
      'banned_factions',
      CASE
        WHEN COALESCE(e.value -> 'banned_factions', '[]'::jsonb) ? 'undead_legions'
          THEN COALESCE(e.value -> 'banned_factions', '[]'::jsonb)
        ELSE COALESCE(e.value -> 'banned_factions', '[]'::jsonb) || '["undead_legions"]'::jsonb
      END
    )
  )
  FROM jsonb_each(c."value"::jsonb) AS e
),
"updated_at" = now()
WHERE c."key" = 'standard_ruleset'
  AND jsonb_typeof(c."value"::jsonb) = 'object'
  AND NOT EXISTS (SELECT 1 FROM jsonb_each(c."value"::jsonb) AS x WHERE jsonb_typeof(x.value) <> 'object');
