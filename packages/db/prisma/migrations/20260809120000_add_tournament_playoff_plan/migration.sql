-- BaLi playoff plan freeze: persist the frozen division skeleton per tournament (division count,
-- band anchors, target sizes, per-band draw counts). Written when the FIRST division playoff is
-- generated; NULL until then. See plans/bali-playoff-plan-freeze.md.
ALTER TABLE "Tournament" ADD COLUMN "playoff_plan" JSONB;
