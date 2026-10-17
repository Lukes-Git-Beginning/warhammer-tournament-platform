-- Land Battle: the classic battle type (no capture points). On its own because Postgres cannot use a
-- freshly added enum value in the same transaction that adds it.
ALTER TYPE "BattleType" ADD VALUE 'LAND_BATTLE' BEFORE 'SIEGE';
