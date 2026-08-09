-- Double Elimination bracket reset: a configurable second, decisive Grand Final when the
-- Losers-bracket champion wins the first. grand_final_reset toggles it (default on = true double
-- elim); grand_final_reset_format is the reset match's format (NULL = inherit finale_match_format).
-- Match.match_format is a per-match format override (NULL = derive from phase), used by the reset final.
ALTER TABLE "Tournament" ADD COLUMN "grand_final_reset" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tournament" ADD COLUMN "grand_final_reset_format" "MatchFormat";
ALTER TABLE "Match" ADD COLUMN "match_format" "MatchFormat";
