-- Rename organizer_id -> host_id (metadata-only; no data movement).
ALTER TABLE "Tournament" RENAME COLUMN "organizer_id" TO "host_id";
ALTER INDEX "Tournament_organizer_id_idx" RENAME TO "Tournament_host_id_idx";
ALTER TABLE "Tournament" RENAME CONSTRAINT "Tournament_organizer_id_fkey" TO "Tournament_host_id_fkey";
