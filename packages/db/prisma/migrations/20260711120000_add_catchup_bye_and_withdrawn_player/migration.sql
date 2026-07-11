-- AlterEnum: CATCHUP_BYE — a late-join placeholder round. It counts as a played
-- round for pairing depth + Swiss completeness, but scores 0 (no bye point, no
-- Buchholz). Additive value; not referenced in this migration, so it is safe to
-- add alongside the column below in the same transaction (see the DISPUTED add in
-- 20260519090818, same pattern).
ALTER TYPE "MatchStatus" ADD VALUE 'CATCHUP_BYE';

-- AlterTable: withdrawn_player_id flags a survivor's still-open match when the
-- opponent dropped (Withdraw -> Void flow). Null in the normal case.
ALTER TABLE "Match" ADD COLUMN "withdrawn_player_id" UUID;
