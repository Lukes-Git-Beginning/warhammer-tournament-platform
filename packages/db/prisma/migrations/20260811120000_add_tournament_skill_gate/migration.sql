-- NI-5: skill-gate — a host may restrict registration to a gating-band range (1..5).
ALTER TABLE "Tournament" ADD COLUMN "min_band" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "max_band" INTEGER;
