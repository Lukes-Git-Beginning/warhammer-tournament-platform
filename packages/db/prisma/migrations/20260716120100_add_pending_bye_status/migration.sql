-- AlterEnum: PENDING_BYE — a BaLi 2.0 provisional bye. It is created instead of an
-- immediate scoring bye and stays reclaimable into a real match while a same-depth
-- opponent can still appear (late-join, drop->void survivor, host reset); once the
-- round can no longer gain one it crystallises into BYE (or CATCHUP_BYE for a late
-- joiner with no real game yet). Additive value, not referenced in this migration, so
-- it is safe to add in a transaction (same pattern as CATCHUP_BYE in 20260711120000).
ALTER TYPE "MatchStatus" ADD VALUE 'PENDING_BYE';
