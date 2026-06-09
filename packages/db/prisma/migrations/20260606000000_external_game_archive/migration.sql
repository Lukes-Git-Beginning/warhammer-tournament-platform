-- CreateTable
CREATE TABLE "ExternalGame" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'totaltavern',
    "external_tournament_id" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "score" TEXT,
    "player1_name" TEXT NOT NULL,
    "player2_name" TEXT NOT NULL,
    "player1_faction_name" TEXT,
    "player2_faction_name" TEXT,
    "winner_name" TEXT,
    "player1_id" UUID,
    "player2_id" UUID,
    "winner_id" UUID,
    "player1_faction_id" TEXT,
    "player2_faction_id" TEXT,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalGame_source_external_tournament_id_round_player1_name_player2_name_key" ON "ExternalGame"("source", "external_tournament_id", "round", "player1_name", "player2_name");

-- CreateIndex
CREATE INDEX "ExternalGame_player1_id_idx" ON "ExternalGame"("player1_id");

-- CreateIndex
CREATE INDEX "ExternalGame_player2_id_idx" ON "ExternalGame"("player2_id");

-- CreateIndex
CREATE INDEX "ExternalGame_player1_faction_id_player2_faction_id_idx" ON "ExternalGame"("player1_faction_id", "player2_faction_id");

-- AddForeignKey
ALTER TABLE "ExternalGame" ADD CONSTRAINT "ExternalGame_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalGame" ADD CONSTRAINT "ExternalGame_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalGame" ADD CONSTRAINT "ExternalGame_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalGame" ADD CONSTRAINT "ExternalGame_player1_faction_id_fkey" FOREIGN KEY ("player1_faction_id") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalGame" ADD CONSTRAINT "ExternalGame_player2_faction_id_fkey" FOREIGN KEY ("player2_faction_id") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
