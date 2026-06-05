-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MapDecisionMode" ADD VALUE 'RANDOM_NO_REPEAT';
ALTER TYPE "MapDecisionMode" ADD VALUE 'HOST_PRESET';
ALTER TYPE "MapDecisionMode" ADD VALUE 'HOST_PRESET_PICK_BAN';
ALTER TYPE "MapDecisionMode" ADD VALUE 'RANDOM_PICK_BAN';

-- AlterTable
ALTER TABLE "MatchMapDecision" ADD COLUMN     "active_pool" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "map_preset_config" JSONB,
ADD COLUMN     "random_map_pool_played" TEXT[] DEFAULT ARRAY[]::TEXT[];
