-- Per-battle-type GS history: one snapshot row per (user, day, scope), scope = OVERALL or a
-- battle type. The OVERALL rows switch from the raw base GS to the game-weighted Overall skill
-- (the base GS was dragged by a few games in a second battle type), so the old rows are wrong
-- for the new chart and are cleared: the boot backfill (maybeBackfillGsHistoryOnBoot) runs when
-- the table is empty and rebuilds the full history deterministically from the games.
TRUNCATE TABLE "PlayerSkillSnapshot";

-- AlterTable
ALTER TABLE "PlayerSkillSnapshot" ADD COLUMN "battle_type" TEXT NOT NULL DEFAULT 'OVERALL';

-- DropIndex
DROP INDEX "PlayerSkillSnapshot_user_id_snapshot_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSkillSnapshot_user_id_snapshot_date_battle_type_key" ON "PlayerSkillSnapshot"("user_id", "snapshot_date", "battle_type");
