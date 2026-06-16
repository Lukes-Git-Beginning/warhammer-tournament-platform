-- CreateTable
CREATE TABLE "TournamentRestrictedFaction" (
    "tournament_id" UUID NOT NULL,
    "faction_id" TEXT NOT NULL,

    CONSTRAINT "TournamentRestrictedFaction_pkey" PRIMARY KEY ("tournament_id","faction_id")
);

-- CreateIndex
CREATE INDEX "TournamentRestrictedFaction_tournament_id_idx" ON "TournamentRestrictedFaction"("tournament_id");

-- AddForeignKey
ALTER TABLE "TournamentRestrictedFaction" ADD CONSTRAINT "TournamentRestrictedFaction_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRestrictedFaction" ADD CONSTRAINT "TournamentRestrictedFaction_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
