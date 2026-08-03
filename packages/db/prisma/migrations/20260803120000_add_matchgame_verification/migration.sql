-- Replay verification result / reporter explanation for a game report.
ALTER TABLE "MatchGame" ADD COLUMN "verification" JSONB;
