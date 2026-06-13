-- AddColumn Match.counts_for_leaderboard
-- Allows admins/mods/hosts to exclude individual matches from the leaderboard
-- without affecting Swiss standings or deleting data.
ALTER TABLE "Match" ADD COLUMN "counts_for_leaderboard" BOOLEAN NOT NULL DEFAULT true;
