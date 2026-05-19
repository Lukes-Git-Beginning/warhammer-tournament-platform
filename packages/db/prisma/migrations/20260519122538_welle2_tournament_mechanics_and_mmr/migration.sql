-- CreateEnum
CREATE TYPE "PlayoffFormat" AS ENUM ('NONE', 'TOP4', 'TOP8');

-- CreateEnum
CREATE TYPE "MatchFormat" AS ENUM ('BO1', 'BO3', 'BO5');

-- CreateEnum
CREATE TYPE "MapDecisionMode" AS ENUM ('RANDOM', 'PICK_BAN');

-- CreateEnum
CREATE TYPE "StatsSource" AS ENUM ('TT_SEED', 'OWN_DATA', 'HYBRID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TournamentMode" ADD VALUE 'OPEN';
ALTER TYPE "TournamentMode" ADD VALUE 'BPT';
ALTER TYPE "TournamentMode" ADD VALUE 'SLT';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "finale_match_format" "MatchFormat" NOT NULL DEFAULT 'BO3',
ADD COLUMN     "map_decision_mode" "MapDecisionMode" NOT NULL DEFAULT 'PICK_BAN',
ADD COLUMN     "playoff_format" "PlayoffFormat" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "playoff_match_format" "MatchFormat" NOT NULL DEFAULT 'BO3',
ADD COLUMN     "rounds_count" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "swiss_match_format" "MatchFormat" NOT NULL DEFAULT 'BO1',
ALTER COLUMN "mode" SET DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "MatchMapDecision" (
    "match_id" UUID NOT NULL,
    "game_index" INTEGER NOT NULL DEFAULT 0,
    "mode" "MapDecisionMode" NOT NULL,
    "coin_flip_seed" TEXT NOT NULL,
    "top_player_id" UUID NOT NULL,
    "bottom_player_id" UUID NOT NULL,
    "bans_top" TEXT[],
    "bans_bottom" TEXT[],
    "picked_map_id" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "MatchMapDecision_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "MatchBlindPick" (
    "match_id" UUID NOT NULL,
    "game_index" INTEGER NOT NULL DEFAULT 0,
    "player1_faction_id" TEXT,
    "player2_faction_id" TEXT,
    "player1_locked_at" TIMESTAMP(3),
    "player2_locked_at" TIMESTAMP(3),
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "MatchBlindPick_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "Map" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMapPool" (
    "tournament_id" UUID NOT NULL,
    "map_id" TEXT NOT NULL,

    CONSTRAINT "TournamentMapPool_pkey" PRIMARY KEY ("tournament_id","map_id")
);

-- CreateTable
CREATE TABLE "TournamentArmyList" (
    "tournament_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_url" TEXT,
    "screenshot_url" TEXT NOT NULL,
    "parsed_json" JSONB,
    "locked_at" TIMESTAMP(3),
    "revealed_to_opponents_at" TIMESTAMP(3),
    "revealed_publicly_at" TIMESTAMP(3),

    CONSTRAINT "TournamentArmyList_pkey" PRIMARY KEY ("tournament_id","user_id")
);

-- CreateTable
CREATE TABLE "SteamLink" (
    "user_id" UUID NOT NULL,
    "steam_id" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "avatar_url" TEXT,
    "profile_url" TEXT,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FactionMastery" (
    "user_id" UUID NOT NULL,
    "faction_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "last_played_at" TIMESTAMP(3),

    CONSTRAINT "FactionMastery_pkey" PRIMARY KEY ("user_id","faction_id")
);

-- CreateTable
CREATE TABLE "FactionMatchupStat" (
    "season_id" UUID NOT NULL,
    "faction_a_id" TEXT NOT NULL,
    "faction_b_id" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "win_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.5,
    "source" "StatsSource" NOT NULL DEFAULT 'TT_SEED',
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 0.5,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionMatchupStat_pkey" PRIMARY KEY ("season_id","faction_a_id","faction_b_id")
);

-- CreateTable
CREATE TABLE "AntiFarmCap" (
    "season_id" UUID NOT NULL,
    "player_a_id" UUID NOT NULL,
    "player_b_id" UUID NOT NULL,
    "faction_a_id" TEXT NOT NULL,
    "faction_b_id" TEXT NOT NULL,
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "max_cap" INTEGER NOT NULL DEFAULT 200,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AntiFarmCap_pkey" PRIMARY KEY ("season_id","player_a_id","player_b_id","faction_a_id","faction_b_id")
);

-- CreateTable
CREATE TABLE "AdminConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "MatchMapDecision_match_id_idx" ON "MatchMapDecision"("match_id");

-- CreateIndex
CREATE INDEX "MatchBlindPick_match_id_idx" ON "MatchBlindPick"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "Map_slug_key" ON "Map"("slug");

-- CreateIndex
CREATE INDEX "Map_deleted_at_idx" ON "Map"("deleted_at");

-- CreateIndex
CREATE INDEX "TournamentMapPool_tournament_id_idx" ON "TournamentMapPool"("tournament_id");

-- CreateIndex
CREATE INDEX "TournamentArmyList_user_id_idx" ON "TournamentArmyList"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "SteamLink_user_id_key" ON "SteamLink"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "SteamLink_steam_id_key" ON "SteamLink"("steam_id");

-- CreateIndex
CREATE INDEX "FactionMastery_user_id_idx" ON "FactionMastery"("user_id");

-- CreateIndex
CREATE INDEX "FactionMastery_faction_id_idx" ON "FactionMastery"("faction_id");

-- CreateIndex
CREATE INDEX "FactionMatchupStat_season_id_idx" ON "FactionMatchupStat"("season_id");

-- CreateIndex
CREATE INDEX "FactionMatchupStat_faction_a_id_faction_b_id_idx" ON "FactionMatchupStat"("faction_a_id", "faction_b_id");

-- CreateIndex
CREATE INDEX "AntiFarmCap_season_id_player_a_id_player_b_id_idx" ON "AntiFarmCap"("season_id", "player_a_id", "player_b_id");

-- AddForeignKey
ALTER TABLE "MatchMapDecision" ADD CONSTRAINT "MatchMapDecision_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchBlindPick" ADD CONSTRAINT "MatchBlindPick_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMapPool" ADD CONSTRAINT "TournamentMapPool_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMapPool" ADD CONSTRAINT "TournamentMapPool_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentArmyList" ADD CONSTRAINT "TournamentArmyList_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentArmyList" ADD CONSTRAINT "TournamentArmyList_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SteamLink" ADD CONSTRAINT "SteamLink_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMastery" ADD CONSTRAINT "FactionMastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMastery" ADD CONSTRAINT "FactionMastery_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMatchupStat" ADD CONSTRAINT "FactionMatchupStat_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMatchupStat" ADD CONSTRAINT "FactionMatchupStat_faction_a_id_fkey" FOREIGN KEY ("faction_a_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionMatchupStat" ADD CONSTRAINT "FactionMatchupStat_faction_b_id_fkey" FOREIGN KEY ("faction_b_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntiFarmCap" ADD CONSTRAINT "AntiFarmCap_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
