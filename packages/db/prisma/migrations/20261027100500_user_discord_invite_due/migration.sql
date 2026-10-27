-- Weekly Discord prompt: set by the Monday check for fully registered players who are not on the
-- RizzOttoverse server, cleared when they click the prompt away or join (lib/discord-invite.ts).
ALTER TABLE "User" ADD COLUMN "discord_invite_due_at" TIMESTAMP(3);
