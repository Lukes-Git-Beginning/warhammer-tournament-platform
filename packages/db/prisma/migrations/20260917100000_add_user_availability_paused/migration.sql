-- Availability pause: temporarily stop being matchable without deleting calendar slots.
ALTER TABLE "User" ADD COLUMN "availability_paused" BOOLEAN NOT NULL DEFAULT false;
