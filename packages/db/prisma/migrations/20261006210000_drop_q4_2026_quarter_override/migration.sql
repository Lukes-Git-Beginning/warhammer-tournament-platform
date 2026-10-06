-- Drop the 2026-Q4 quarter override. It only shifted the end to 2026-12-31 23:59 (no custom name),
-- which left a one-minute gap before Q1 2027 and showed the quarter as "CUSTOM". Since v2.11.4 the
-- calendar default already ends the quarter at Europe/Berlin midnight, so the plain default is
-- correct. Guarded on name IS NULL so a custom name (if one was set meanwhile) is never lost.
DELETE FROM "QuarterConfig" WHERE "period" = '2026-Q4' AND "name" IS NULL;
