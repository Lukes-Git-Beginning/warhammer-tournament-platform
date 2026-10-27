-- The welcome page is back (2026-10-27): new players see it once after their first login. The overlay was
-- unmounted from 2026-06-13 until now, so almost every existing player still has onboarded_at = NULL and
-- would get the welcome page at release. They are past it: existing players get the release banner instead.
UPDATE "User" SET "onboarded_at" = now() WHERE "onboarded_at" IS NULL;
