-- AlterEnum
-- Late-join: a participant who has requested to join after the tournament started
-- and is awaiting host approval before entering play (excluded from pairings/standings).
ALTER TYPE "ParticipantStatus" ADD VALUE 'JOIN_REQUESTED';
