-- Daily snapshot of a player's timeless General Skill (design doc §3). GS is
-- derive-on-read and not historically reconstructable, so we persist a daily row;
-- version_id is a context tag (no FK). One row per (user, day).

-- CreateTable
CREATE TABLE "PlayerSkillSnapshot" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "general_skill" DOUBLE PRECISION NOT NULL,
    "std_error" DOUBLE PRECISION NOT NULL,
    "band" INTEGER NOT NULL,
    "games_count" INTEGER NOT NULL,
    "version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerSkillSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerSkillSnapshot_snapshot_date_idx" ON "PlayerSkillSnapshot"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSkillSnapshot_user_id_snapshot_date_key" ON "PlayerSkillSnapshot"("user_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "PlayerSkillSnapshot" ADD CONSTRAINT "PlayerSkillSnapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
