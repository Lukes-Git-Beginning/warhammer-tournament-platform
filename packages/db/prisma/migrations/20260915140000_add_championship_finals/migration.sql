-- CreateEnum
CREATE TYPE "ChampionshipKind" AS ENUM ('NONE', 'QUARTERLY', 'MONTHLY_LADDER');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "championship_kind" "ChampionshipKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "championship_period" TEXT;

-- CreateTable
CREATE TABLE "CompetitiveCycleSnapshot" (
    "id" UUID NOT NULL,
    "kind" "ChampionshipKind" NOT NULL,
    "period" TEXT NOT NULL,
    "battle_type" "BattleType" NOT NULL,
    "competitor_format" "CompetitorFormat" NOT NULL,
    "competitor_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "gs" DOUBLE PRECISION,
    "points" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitiveCycleSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitiveCycleSnapshot_kind_period_battle_type_competitor_idx" ON "CompetitiveCycleSnapshot"("kind", "period", "battle_type", "competitor_format");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitiveCycleSnapshot_kind_period_battle_type_competitor_key" ON "CompetitiveCycleSnapshot"("kind", "period", "battle_type", "competitor_format", "competitor_id");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_championship_kind_battle_type_competitor_format__key" ON "Tournament"("championship_kind", "battle_type", "competitor_format", "championship_period");
