-- #50: optional stream/broadcast link per tournament, shown on the tournament page
-- and appended to spectator DMs. Additive, nullable — no existing tournament changes.
ALTER TABLE "Tournament" ADD COLUMN "stream_url" TEXT;
