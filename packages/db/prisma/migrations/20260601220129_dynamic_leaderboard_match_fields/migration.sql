-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "played_at" TIMESTAMP(3),
ADD COLUMN     "ruleset" TEXT,
ADD COLUMN     "season_id" UUID;

-- CreateIndex
CREATE INDEX "Match_season_id_status_idx" ON "Match"("season_id", "status");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing completed matches so the dynamic leaderboard sees history.
-- played_at: use the completion timestamp (updated_at).
UPDATE "Match"
SET "played_at" = "updated_at"
WHERE "status" = 'COMPLETED' AND "played_at" IS NULL;

-- season_id: the season whose [start_date, end_date] window contains updated_at.
UPDATE "Match" m
SET "season_id" = s."id"
FROM "Season" s
WHERE m."status" = 'COMPLETED'
  AND m."season_id" IS NULL
  AND m."updated_at" >= s."start_date"
  AND m."updated_at" <= s."end_date";
