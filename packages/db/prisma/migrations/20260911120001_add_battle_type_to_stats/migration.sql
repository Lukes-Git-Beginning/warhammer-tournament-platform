-- Meta keyed per (version, battle_type): faction stats, matchup heatmap and the
-- daily faction snapshot now split by battle type (design doc §4). Existing rows
-- back-tag to DOMINATION via the column default, so the widened unique keys stay
-- collision-free (the prior (faction, version) keys were already unique).

-- DropIndex
DROP INDEX "FactionStats_faction_id_season_id_key";

-- DropIndex
DROP INDEX "FactionStatsSnapshot_faction_id_season_id_snapshot_date_key";

-- DropIndex
DROP INDEX "MatchupStats_faction_a_id_faction_b_id_season_id_key";

-- AlterTable
ALTER TABLE "FactionStats" ADD COLUMN     "battle_type" "BattleType" NOT NULL DEFAULT 'DOMINATION';

-- AlterTable
ALTER TABLE "FactionStatsSnapshot" ADD COLUMN     "battle_type" "BattleType" NOT NULL DEFAULT 'DOMINATION';

-- AlterTable
ALTER TABLE "MatchupStats" ADD COLUMN     "battle_type" "BattleType" NOT NULL DEFAULT 'DOMINATION';

-- CreateIndex
CREATE UNIQUE INDEX "FactionStats_faction_id_season_id_battle_type_key" ON "FactionStats"("faction_id", "season_id", "battle_type");

-- CreateIndex
CREATE UNIQUE INDEX "FactionStatsSnapshot_faction_id_season_id_battle_type_snaps_key" ON "FactionStatsSnapshot"("faction_id", "season_id", "battle_type", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupStats_faction_a_id_faction_b_id_season_id_battle_typ_key" ON "MatchupStats"("faction_a_id", "faction_b_id", "season_id", "battle_type");
