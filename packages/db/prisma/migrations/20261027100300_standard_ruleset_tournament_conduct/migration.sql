-- Tournament-only conduct (Alex, 2026-10-27): the round limit applies only in tournaments, and so does
-- disqualification for cheating (in Open Play the result is voided instead). Every Standard Ruleset combo
-- gets a `tournament_conduct` list: the cheating consequence, then each round-limit line moved out of
-- `conduct`. The default exploit line in `conduct` loses its tournament consequence; an admin-edited
-- exploit line stays as it is. Combos that already have `tournament_conduct` are left alone, so the
-- statement can run twice. Without a stored ruleset the code defaults apply (they are split already).
UPDATE "AdminConfig" c
SET "value" = (
      SELECT jsonb_object_agg(e."key",
        CASE
          WHEN jsonb_typeof(e."value") <> 'object'
            OR e."value" ? 'tournament_conduct'
            OR jsonb_typeof(e."value"->'conduct') IS DISTINCT FROM 'array'
            THEN e."value"
          ELSE e."value" || jsonb_build_object(
            'conduct', COALESCE((
              SELECT jsonb_agg(
                       CASE WHEN a.x #>> '{}' = 'Exploiting bugs or glitches is considered cheating and results in disqualification.'
                            THEN to_jsonb('Exploiting bugs or glitches is considered cheating.'::text)
                            ELSE a.x END
                       ORDER BY a.i)
              FROM jsonb_array_elements(e."value"->'conduct') WITH ORDINALITY AS a(x, i)
              WHERE a.x #>> '{}' NOT ILIKE '%round limit%'), '[]'::jsonb),
            'tournament_conduct',
              (CASE WHEN e."value"->'conduct' @> '["Exploiting bugs or glitches is considered cheating and results in disqualification."]'::jsonb
                    THEN '["Cheating results in disqualification."]'::jsonb
                    ELSE '[]'::jsonb END)
              || COALESCE((
                SELECT jsonb_agg(a.x ORDER BY a.i)
                FROM jsonb_array_elements(e."value"->'conduct') WITH ORDINALITY AS a(x, i)
                WHERE a.x #>> '{}' ILIKE '%round limit%'), '[]'::jsonb)
          )
        END)
      FROM jsonb_each(c."value") AS e("key", "value")
    ),
    "updated_at" = now()
WHERE c."key" = 'standard_ruleset'
  AND jsonb_typeof(c."value") = 'object'
  AND c."value" <> '{}'::jsonb;
