-- AvailabilitySlot: store LOCAL time (weekday + hour in the user's timezone) instead of UTC, so a
-- slot keeps the same wall-clock hour across daylight-saving changes. UTC is derived at read time.

-- 1. Rename the column and the indexes that carry its name.
ALTER TABLE "AvailabilitySlot" RENAME COLUMN "hour_utc" TO "hour_local";
ALTER INDEX "AvailabilitySlot_day_of_week_hour_utc_context_idx" RENAME TO "AvailabilitySlot_day_of_week_hour_local_context_idx";
ALTER INDEX "AvailabilitySlot_user_id_day_of_week_hour_utc_context_key" RENAME TO "AvailabilitySlot_user_id_day_of_week_hour_local_context_key";

-- 2. Convert existing rows from UTC to local time.
-- The old UI stored (weekday, hour) in UTC using the user's whole-hour UTC offset AT SAVE TIME
-- (created_at = last save). Reverse exactly that: local = utc + round(offset at created_at).
-- Users without a (valid) timezone fall back to Europe/Berlin; their grid was shown in UTC, so the
-- slot keeps its absolute instant and is expressed in Berlin time.
-- BEGIN conversion
CREATE TEMP TABLE "_availability_slot_local" AS
SELECT
  s."id",
  s."user_id",
  s."context",
  s."created_at",
  (((s."day_of_week" * 24 + s."hour_local" + z."off_h") % 168 + 168) % 168) AS "local_pos"
FROM "AvailabilitySlot" s
JOIN "User" u ON u."id" = s."user_id"
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN u."timezone" IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n."name" = u."timezone")
      THEN u."timezone"
    ELSE 'Europe/Berlin'
  END AS "tz"
) t
CROSS JOIN LATERAL (
  SELECT floor(EXTRACT(EPOCH FROM ((s."created_at" AT TIME ZONE 'UTC') AT TIME ZONE t."tz") - s."created_at") / 3600.0 + 0.5)::int AS "off_h"
) z;

DELETE FROM "AvailabilitySlot";

INSERT INTO "AvailabilitySlot" ("id", "user_id", "day_of_week", "hour_local", "context", "created_at")
SELECT DISTINCT ON ("user_id", "local_pos", "context")
  "id", "user_id", "local_pos" / 24, "local_pos" % 24, "context", "created_at"
FROM "_availability_slot_local"
ORDER BY "user_id", "local_pos", "context", "created_at";

DROP TABLE "_availability_slot_local";
-- END conversion
