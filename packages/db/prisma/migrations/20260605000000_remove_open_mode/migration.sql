-- Migration: remove OPEN from TournamentMode enum, migrate existing rows to BPT

-- Step 1: migrate existing OPEN rows to BPT before dropping the value
UPDATE "Tournament" SET "mode" = 'BPT' WHERE "mode" = 'OPEN';

-- Step 2: recreate enum without OPEN
ALTER TYPE "TournamentMode" RENAME TO "TournamentMode_old";
CREATE TYPE "TournamentMode" AS ENUM ('ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'BPT', 'SFT', 'SLT');
ALTER TABLE "Tournament" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "Tournament" ALTER COLUMN "mode" TYPE "TournamentMode" USING "mode"::text::"TournamentMode";
ALTER TABLE "Tournament" ALTER COLUMN "mode" SET DEFAULT 'BPT'::"TournamentMode";
DROP TYPE "TournamentMode_old";
