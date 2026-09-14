-- AlterTable
ALTER TABLE "TournamentSeries" ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TournamentSeriesHost" (
    "series_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "TournamentSeriesHost_pkey" PRIMARY KEY ("series_id","user_id")
);

-- CreateIndex
CREATE INDEX "TournamentSeriesHost_series_id_idx" ON "TournamentSeriesHost"("series_id");

-- CreateIndex
CREATE INDEX "TournamentSeriesHost_user_id_idx" ON "TournamentSeriesHost"("user_id");

-- AddForeignKey
ALTER TABLE "TournamentSeriesHost" ADD CONSTRAINT "TournamentSeriesHost_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "TournamentSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentSeriesHost" ADD CONSTRAINT "TournamentSeriesHost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
