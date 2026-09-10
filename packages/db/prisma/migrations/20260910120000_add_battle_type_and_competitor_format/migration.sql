-- Orthogonal competitive axes (plans/game-versions-and-competitive-structure.md):
-- battle_type = the KIND of game (Domination/Conquest/Siege); competitor_format = team size (1v1/2v2).
-- Every existing row back-tags to the current world (Domination / 1v1) via the column defaults.
--
-- NOTE: the Season->GameVersion and season_id->version_id rename is a Prisma @@map/@map mapping
-- ONLY — the table stays "Season" and the FK columns stay "season_id", so there is no DDL for it.

-- CreateEnum
CREATE TYPE "BattleType" AS ENUM ('DOMINATION', 'CONQUEST', 'SIEGE');

-- CreateEnum
CREATE TYPE "CompetitorFormat" AS ENUM ('ONE_V_ONE', 'TWO_V_TWO');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "battle_type" "BattleType" NOT NULL DEFAULT 'DOMINATION',
ADD COLUMN     "competitor_format" "CompetitorFormat" NOT NULL DEFAULT 'ONE_V_ONE';

-- AlterTable
ALTER TABLE "MatchGame" ADD COLUMN     "battle_type" "BattleType" NOT NULL DEFAULT 'DOMINATION';

-- AlterTable
ALTER TABLE "Map" ADD COLUMN     "battle_types" "BattleType"[] DEFAULT ARRAY['DOMINATION']::"BattleType"[];
