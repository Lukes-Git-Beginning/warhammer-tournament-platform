-- BO2 series format (two-leg home/away for 1v3): exactly 2 games, roles swap,
-- 1–1 resolves to a Draw. Additive enum value — prod-safe, no backfill.

ALTER TYPE "MatchFormat" ADD VALUE IF NOT EXISTS 'BO2';
