-- Balanced Liechtenstein: store each participant's skill division (matchmakingBand
-- 1..5), fixed at registration. Additive + nullable → safe online change.
ALTER TABLE "TournamentParticipant" ADD COLUMN "skill_band" INTEGER;
