-- Add MatchStatus values for Discord-native Open Play result flow.
-- AWAITING_CONFIRMATION: one player declared a result, waiting for opponent.
-- CANCELLED: both players agreed to close the match without a result.
ALTER TYPE "MatchStatus" ADD VALUE 'AWAITING_CONFIRMATION';
ALTER TYPE "MatchStatus" ADD VALUE 'CANCELLED';
