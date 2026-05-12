-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ORGANIZER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SWISS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "TournamentMode" AS ENUM ('ONE_V_ONE', 'THREE_V_THREE', 'BLIND_PICK', 'SFT');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TournamentVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('REGISTERED', 'CHECKED_IN', 'DISQUALIFIED', 'WITHDREW');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'ONGOING', 'COMPLETED', 'BYE', 'FORFEIT');

-- CreateEnum
CREATE TYPE "FactionCategory" AS ENUM ('ORDER', 'DESTRUCTION', 'CHAOS_GODS', 'UNDEAD', 'DEFAULT');

-- CreateEnum
CREATE TYPE "ArmyListFileType" AS ENUM ('ARMY_SETUP', 'SCREENSHOT');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "discord_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "avatar_url" TEXT,
    "timezone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "preferred_factions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "race" TEXT NOT NULL,
    "category" "FactionCategory" NOT NULL,
    "color_hex" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "icon_url" TEXT,
    "game_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "poster_url" TEXT,
    "organizer_id" UUID NOT NULL,
    "format" "TournamentFormat" NOT NULL,
    "mode" "TournamentMode" NOT NULL DEFAULT 'ONE_V_ONE',
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "TournamentVisibility" NOT NULL DEFAULT 'PUBLIC',
    "max_participants" INTEGER,
    "start_date" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "registration_deadline" TIMESTAMP(3),
    "rules" TEXT NOT NULL DEFAULT '',
    "discord_link" TEXT,
    "entry_fee" TEXT,
    "draft_enabled" BOOLEAN NOT NULL DEFAULT false,
    "draft_preset_id" UUID,
    "counts_for_leaderboard" BOOLEAN NOT NULL DEFAULT true,
    "is_major" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentFactionAllowlist" (
    "tournament_id" UUID NOT NULL,
    "faction_id" TEXT NOT NULL,

    CONSTRAINT "TournamentFactionAllowlist_pkey" PRIMARY KEY ("tournament_id","faction_id")
);

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "faction_id" TEXT,
    "army_list_id" UUID,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'REGISTERED',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "match_number" INTEGER NOT NULL,
    "player1_id" UUID,
    "player2_id" UUID,
    "winner_id" UUID,
    "score" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_time" TIMESTAMP(3),
    "next_match_id" UUID,
    "player1_faction_id" TEXT,
    "player2_faction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "captain_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "dlc_tag" TEXT,
    "major_tournament_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "total_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elo_rating" INTEGER NOT NULL DEFAULT 1200,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentResult" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID,
    "placement" INTEGER NOT NULL,
    "points_earned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elo_change" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArmyList" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tournament_id" UUID,
    "faction_id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" "ArmyListFileType" NOT NULL,
    "parsed_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArmyList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionStats" (
    "id" UUID NOT NULL,
    "faction_id" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "pick_count" INTEGER NOT NULL DEFAULT 0,
    "ban_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionStatsSnapshot" (
    "id" UUID NOT NULL,
    "faction_id" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "matches_played" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "draws" INTEGER NOT NULL,
    "pick_count" INTEGER NOT NULL,
    "ban_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactionStatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupStats" (
    "id" UUID NOT NULL,
    "faction_a_id" TEXT NOT NULL,
    "faction_b_id" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "faction_a_wins" INTEGER NOT NULL DEFAULT 0,
    "faction_b_wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchupStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPreset" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "category_limits" JSONB NOT NULL DEFAULT '{}',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "preset_id" UUID NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "current_turn" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL DEFAULT '{}',
    "timer_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discord_id_key" ON "User"("discord_id");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deleted_at_idx" ON "User"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "Faction_display_order_key" ON "Faction"("display_order");

-- CreateIndex
CREATE INDEX "Faction_category_idx" ON "Faction"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_slug_key" ON "Tournament"("slug");

-- CreateIndex
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- CreateIndex
CREATE INDEX "Tournament_organizer_id_idx" ON "Tournament"("organizer_id");

-- CreateIndex
CREATE INDEX "Tournament_start_date_idx" ON "Tournament"("start_date");

-- CreateIndex
CREATE INDEX "Tournament_deleted_at_idx" ON "Tournament"("deleted_at");

-- CreateIndex
CREATE INDEX "TournamentFactionAllowlist_tournament_id_idx" ON "TournamentFactionAllowlist"("tournament_id");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournament_id_status_idx" ON "TournamentParticipant"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "TournamentParticipant_user_id_idx" ON "TournamentParticipant"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournament_id_user_id_key" ON "TournamentParticipant"("tournament_id", "user_id");

-- CreateIndex
CREATE INDEX "Match_tournament_id_status_idx" ON "Match"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "Match_player1_id_idx" ON "Match"("player1_id");

-- CreateIndex
CREATE INDEX "Match_player2_id_idx" ON "Match"("player2_id");

-- CreateIndex
CREATE INDEX "Match_deleted_at_idx" ON "Match"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournament_id_round_match_number_key" ON "Match"("tournament_id", "round", "match_number");

-- CreateIndex
CREATE INDEX "Team_tournament_id_idx" ON "Team"("tournament_id");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_team_id_user_id_key" ON "TeamMember"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "Season_is_active_idx" ON "Season"("is_active");

-- CreateIndex
CREATE INDEX "Season_start_date_idx" ON "Season"("start_date");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_season_id_total_points_idx" ON "LeaderboardEntry"("season_id", "total_points" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_user_id_season_id_key" ON "LeaderboardEntry"("user_id", "season_id");

-- CreateIndex
CREATE INDEX "TournamentResult_user_id_idx" ON "TournamentResult"("user_id");

-- CreateIndex
CREATE INDEX "TournamentResult_season_id_idx" ON "TournamentResult"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentResult_tournament_id_user_id_key" ON "TournamentResult"("tournament_id", "user_id");

-- CreateIndex
CREATE INDEX "ArmyList_user_id_idx" ON "ArmyList"("user_id");

-- CreateIndex
CREATE INDEX "ArmyList_tournament_id_idx" ON "ArmyList"("tournament_id");

-- CreateIndex
CREATE INDEX "FactionStats_season_id_idx" ON "FactionStats"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "FactionStats_faction_id_season_id_key" ON "FactionStats"("faction_id", "season_id");

-- CreateIndex
CREATE INDEX "FactionStatsSnapshot_faction_id_season_id_idx" ON "FactionStatsSnapshot"("faction_id", "season_id");

-- CreateIndex
CREATE INDEX "FactionStatsSnapshot_snapshot_date_idx" ON "FactionStatsSnapshot"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "FactionStatsSnapshot_faction_id_season_id_snapshot_date_key" ON "FactionStatsSnapshot"("faction_id", "season_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "MatchupStats_season_id_idx" ON "MatchupStats"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupStats_faction_a_id_faction_b_id_season_id_key" ON "MatchupStats"("faction_a_id", "faction_b_id", "season_id");

-- CreateIndex
CREATE INDEX "DraftPreset_is_public_idx" ON "DraftPreset"("is_public");

-- CreateIndex
CREATE INDEX "DraftPreset_created_by_idx" ON "DraftPreset"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_match_id_key" ON "Draft"("match_id");

-- CreateIndex
CREATE INDEX "Draft_status_idx" ON "Draft"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entity_type_entity_id_idx" ON "AuditLog"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_draft_preset_id_fkey" FOREIGN KEY ("draft_preset_id") REFERENCES "DraftPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentFactionAllowlist" ADD CONSTRAINT "TournamentFactionAllowlist_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentFactionAllowlist" ADD CONSTRAINT "TournamentFactionAllowlist_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_army_list_id_fkey" FOREIGN KEY ("army_list_id") REFERENCES "ArmyList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_next_match_id_fkey" FOREIGN KEY ("next_match_id") REFERENCES "Match"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_player1_faction_id_fkey" FOREIGN KEY ("player1_faction_id") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_player2_faction_id_fkey" FOREIGN KEY ("player2_faction_id") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_major_tournament_id_fkey" FOREIGN KEY ("major_tournament_id") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmyList" ADD CONSTRAINT "ArmyList_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmyList" ADD CONSTRAINT "ArmyList_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStats" ADD CONSTRAINT "FactionStats_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStats" ADD CONSTRAINT "FactionStats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStatsSnapshot" ADD CONSTRAINT "FactionStatsSnapshot_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionStatsSnapshot" ADD CONSTRAINT "FactionStatsSnapshot_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupStats" ADD CONSTRAINT "MatchupStats_faction_a_id_fkey" FOREIGN KEY ("faction_a_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupStats" ADD CONSTRAINT "MatchupStats_faction_b_id_fkey" FOREIGN KEY ("faction_b_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupStats" ADD CONSTRAINT "MatchupStats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPreset" ADD CONSTRAINT "DraftPreset_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "DraftPreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
