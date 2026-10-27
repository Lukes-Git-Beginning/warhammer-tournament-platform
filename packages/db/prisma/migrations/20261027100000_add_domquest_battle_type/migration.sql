-- Domquest: the arena mode of RizzOtto's Arena Mod (Conquest-sized armies on the Domination engine, one
-- capture point). On its own because Postgres cannot use a freshly added enum value in the same
-- transaction that adds it.
ALTER TYPE "BattleType" ADD VALUE 'DOMQUEST' AFTER 'DOMINATION';
