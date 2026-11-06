-- VL picking in Open Play (plans/discord-open-play.md §11): the weekly ban on the profile, its snapshot per match,
-- and the match's faction step (3x3 matrix for a 1v1 Bo3 in Land Battle or Conquest). Plus the option to hide one's
-- replays for 30 days after each game.
ALTER TABLE "User" ADD COLUMN "weekly_ban_faction_id" TEXT,
ADD COLUMN "weekly_ban_set_at" TIMESTAMP(3),
ADD COLUMN "hide_replays" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Match" ADD COLUMN "pick_mode" "TournamentMode",
ADD COLUMN "weekly_bans" JSONB;
