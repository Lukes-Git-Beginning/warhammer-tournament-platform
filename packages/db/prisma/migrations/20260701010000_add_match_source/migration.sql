-- Distinguish Open Play Ladder (queue) matches from Challenge matches in "All Games".
CREATE TYPE "MatchSource" AS ENUM ('QUEUE', 'CHALLENGE');

ALTER TABLE "Match" ADD COLUMN "source" "MatchSource";

-- Backfill: OPEN_PLAY matches referenced by a ScheduledMatchup are challenges;
-- every other OPEN_PLAY match came from the live queue.
UPDATE "Match" SET "source" = 'CHALLENGE'
WHERE "id" IN (SELECT "match_id" FROM "ScheduledMatchup" WHERE "match_id" IS NOT NULL);

UPDATE "Match" SET "source" = 'QUEUE'
WHERE "type" = 'OPEN_PLAY' AND "source" IS NULL;
