-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "is_series_final" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "series_id" UUID,
ADD COLUMN     "series_position" INTEGER;

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN     "seed" INTEGER;

-- CreateTable
CREATE TABLE "TournamentSeries" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "poster_url" TEXT,
    "owner_id" UUID NOT NULL,
    "scoring_config" JSONB NOT NULL,
    "final_tournament_id" UUID,
    "final_seeded_at" TIMESTAMP(3),
    "visibility" "TournamentVisibility" NOT NULL DEFAULT 'PUBLIC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "TournamentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentSeries_slug_key" ON "TournamentSeries"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentSeries_final_tournament_id_key" ON "TournamentSeries"("final_tournament_id");

-- CreateIndex
CREATE INDEX "TournamentSeries_owner_id_idx" ON "TournamentSeries"("owner_id");

-- CreateIndex
CREATE INDEX "TournamentSeries_deleted_at_idx" ON "TournamentSeries"("deleted_at");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "TournamentSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentSeries" ADD CONSTRAINT "TournamentSeries_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentSeries" ADD CONSTRAINT "TournamentSeries_final_tournament_id_fkey" FOREIGN KEY ("final_tournament_id") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;
