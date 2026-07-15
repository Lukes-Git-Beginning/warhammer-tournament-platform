-- #12: distinguish Open-Play matches grabbed via an availability DM from those
-- paired out of the live queue. Additive: new MatchSource enum value. Prod-safe,
-- no backfill (existing rows keep QUEUE/CHALLENGE/NULL).

ALTER TYPE "MatchSource" ADD VALUE 'AVAILABILITY';
