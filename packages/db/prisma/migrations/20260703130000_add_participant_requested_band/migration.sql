-- Balanced Liechtenstein play-up: the division a player opts into at registration
-- (the effective skill_band is max(computed, requested) at Start). Additive +
-- nullable → safe online change.
ALTER TABLE "TournamentParticipant" ADD COLUMN "requested_band" INTEGER;
