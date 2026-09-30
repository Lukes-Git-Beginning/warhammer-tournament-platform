-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('PENDING', 'AVAILABLE', 'DECLINED');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "availability_opened_at" TIMESTAMP(3),
ADD COLUMN     "rsvp_deadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChampionshipInvite" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "competitor_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "rsvp" "RsvpStatus" NOT NULL DEFAULT 'PENDING',
    "rsvp_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChampionshipInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChampionshipInvite_tournament_id_rsvp_idx" ON "ChampionshipInvite"("tournament_id", "rsvp");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionshipInvite_tournament_id_competitor_id_key" ON "ChampionshipInvite"("tournament_id", "competitor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionshipInvite_tournament_id_user_id_key" ON "ChampionshipInvite"("tournament_id", "user_id");

-- AddForeignKey
ALTER TABLE "ChampionshipInvite" ADD CONSTRAINT "ChampionshipInvite_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
