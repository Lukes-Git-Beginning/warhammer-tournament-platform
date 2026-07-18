-- Add optional minimum-participant target to Tournament. Nullable, no default:
-- a soft target used to warn (not block) the host at start time.
ALTER TABLE "Tournament" ADD COLUMN "min_participants" INTEGER;
