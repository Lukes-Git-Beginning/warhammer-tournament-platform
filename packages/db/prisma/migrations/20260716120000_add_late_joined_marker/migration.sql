-- AlterTable: late_joined marks a Balanced Liechtenstein participant admitted after
-- bracket generation (late-join OR post-bracket force-checkin). Set once at admission,
-- never reset. Drives the 0-point catch-up-bye rule independent of registered_at.
-- Additive; existing rows default to false (they were on-time).
ALTER TABLE "TournamentParticipant" ADD COLUMN "late_joined" BOOLEAN NOT NULL DEFAULT false;
