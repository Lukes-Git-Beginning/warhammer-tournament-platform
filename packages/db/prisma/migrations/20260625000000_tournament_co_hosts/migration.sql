-- CreateTable
CREATE TABLE "TournamentHost" (
    "tournament_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "TournamentHost_pkey" PRIMARY KEY ("tournament_id","user_id")
);

-- CreateIndex
CREATE INDEX "TournamentHost_tournament_id_idx" ON "TournamentHost"("tournament_id");

-- CreateIndex
CREATE INDEX "TournamentHost_user_id_idx" ON "TournamentHost"("user_id");

-- AddForeignKey
ALTER TABLE "TournamentHost" ADD CONSTRAINT "TournamentHost_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentHost" ADD CONSTRAINT "TournamentHost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
