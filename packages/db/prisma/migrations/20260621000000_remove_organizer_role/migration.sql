-- Remove ORGANIZER from the Role enum.
-- All ORGANIZER users were already converted to HOST in migration 20260612120000.
-- No data migration needed — this is purely a schema cleanup.

-- Postgres requires recreating the enum type to remove a value.
CREATE TYPE "Role_new" AS ENUM ('USER', 'HOST', 'MODERATOR', 'ADMIN');

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_new"
  USING "role"::text::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
