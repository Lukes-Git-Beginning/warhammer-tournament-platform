-- VL picking in Open Play (plans/discord-open-play.md §11): the weekly ban on the profile, its snapshot per match,
-- and the match's faction step (3x3 matrix for a 1v1 Bo3 in Land Battle or Conquest).
ALTER TABLE "User" ADD COLUMN "weekly_ban_faction_id" TEXT,
ADD COLUMN "weekly_ban_set_at" TIMESTAMP(3);

ALTER TABLE "Match" ADD COLUMN "pick_mode" "TournamentMode",
ADD COLUMN "weekly_bans" JSONB;
