-- #14 queue-abuse escalation, surfaced in the Queue Activity tab.
-- Additive: two new QueueEventType values + a nullable escalation level. Prod-safe, no backfill.

ALTER TYPE "QueueEventType" ADD VALUE 'WARNING';
ALTER TYPE "QueueEventType" ADD VALUE 'TIMEOUT';

ALTER TABLE "QueueActivityLog" ADD COLUMN "level" INTEGER;
