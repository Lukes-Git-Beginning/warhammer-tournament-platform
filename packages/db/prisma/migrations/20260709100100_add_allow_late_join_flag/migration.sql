-- Late-join: opt-in per tournament. When on, users can request to join after the
-- tournament has started and the host approves each request. Additive, default
-- false — no existing tournament changes behaviour.
ALTER TABLE "Tournament" ADD COLUMN "allow_late_join_requests" BOOLEAN NOT NULL DEFAULT false;
