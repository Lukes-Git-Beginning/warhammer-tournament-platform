-- Drop deprecated Welle-2 MMR tables, column, index, and enum.
-- These models (FactionMastery, FactionMatchupStat, AntiFarmCap) were
-- superseded by the derive-on-read dynamic leaderboard (feat/dynamic-leaderboard).
-- LeaderboardEntry.season_points was replaced by total_points (derive-on-read).
-- StatsSource was only used by FactionMatchupStat.
-- All tables are empty (AntiFarmCap=0, FactionMatchupStat=0) or data is
-- non-critical legacy (FactionMastery rows no longer written post-cutover).

-- Drop indexes before dropping tables (defensive; Postgres drops them with the table, but explicit is cleaner)
DROP INDEX IF EXISTS "FactionMastery_user_id_idx";
DROP INDEX IF EXISTS "FactionMastery_faction_id_idx";
DROP INDEX IF EXISTS "FactionMatchupStat_season_id_idx";
DROP INDEX IF EXISTS "FactionMatchupStat_faction_a_id_faction_b_id_idx";
DROP INDEX IF EXISTS "AntiFarmCap_season_id_player_a_id_player_b_id_idx";

-- Drop deprecated tables
DROP TABLE "FactionMastery";
DROP TABLE "FactionMatchupStat";
DROP TABLE "AntiFarmCap";

-- Drop deprecated index on LeaderboardEntry
DROP INDEX IF EXISTS "LeaderboardEntry_season_id_season_points_idx";

-- Drop deprecated column on LeaderboardEntry
ALTER TABLE "LeaderboardEntry" DROP COLUMN "season_points";

-- Drop deprecated enum (was only used by FactionMatchupStat.source)
DROP TYPE "StatsSource";
