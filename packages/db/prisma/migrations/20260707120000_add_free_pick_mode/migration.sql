-- AlterEnum
-- Enticity's Free Pick mode: per-player choice of a fixed faction (faction_id set)
-- or picking match-by-match (faction_id null). No new column — the existing
-- TournamentParticipant.faction_id carries the choice.
ALTER TYPE "TournamentMode" ADD VALUE 'FREE_PICK';
