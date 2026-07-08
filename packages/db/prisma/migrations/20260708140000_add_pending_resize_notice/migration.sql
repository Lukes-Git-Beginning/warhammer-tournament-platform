-- #40: flag set when dynamic auto-sizing changed the bracket mid-round; the round-
-- advance flow sends the size-change DM once and clears it. Additive, default false.
ALTER TABLE "Tournament" ADD COLUMN "pending_resize_notice" BOOLEAN NOT NULL DEFAULT false;
