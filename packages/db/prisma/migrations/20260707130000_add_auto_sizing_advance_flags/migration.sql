-- #37: externalise the two AUTO_SWISS behaviours as opt-in flags for any format.
-- Additive, default false — no existing tournament changes behaviour.
ALTER TABLE "Tournament" ADD COLUMN "auto_sizing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tournament" ADD COLUMN "auto_advance" BOOLEAN NOT NULL DEFAULT false;
