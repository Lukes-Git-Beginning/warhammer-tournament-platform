-- Remove ORGANIZER from the Role enum.
-- All ORGANIZER users were already converted to HOST in migration 20260612120000.
--
-- Postgres requires recreating the enum type to remove a value.
-- The column default ('USER'::Role) must be dropped first; otherwise
-- DROP TYPE fails because the default expression still references the old type.

-- Step 1: drop the column default that references the old Role type
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

-- Step 2: create the new enum without ORGANIZER
CREATE TYPE "Role_new" AS ENUM ('USER', 'HOST', 'MODERATOR', 'ADMIN');

-- Step 3: migrate the column to the new type
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_new"
  USING "role"::text::"Role_new";

-- Step 4: drop the old type (column and default no longer reference it)
DROP TYPE "Role";

-- Step 5: rename the new type to the canonical name
ALTER TYPE "Role_new" RENAME TO "Role";

-- Step 6: restore the column default
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER'::"Role";
