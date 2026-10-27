-- The release notice for RizzOtto's Arena Mod goes only to players who are not on the RizzOttoverse Discord
-- server yet, and only until they dismiss it: remember the bot's last membership answer and the dismissed
-- notices per user.
ALTER TABLE "User" ADD COLUMN "discord_member" BOOLEAN,
ADD COLUMN "discord_member_checked_at" TIMESTAMP(3),
ADD COLUMN "dismissed_notices" TEXT[] DEFAULT ARRAY[]::TEXT[];
