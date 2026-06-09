-- AlterTable
ALTER TABLE "MatchGame" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Tournament" ALTER COLUMN "finale_match_format" SET DEFAULT 'BO1',
ALTER COLUMN "playoff_match_format" SET DEFAULT 'BO1';
