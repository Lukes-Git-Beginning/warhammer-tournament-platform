-- Append-only tournament lifecycle event log (durable forensics of playoff generation,
-- participant joins/drops/withdrawals, reseeds). Never updated or deleted.

-- CreateTable
CREATE TABLE "TournamentEvent" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "actor_id" UUID,
    "subject_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentEvent_tournament_id_created_at_idx" ON "TournamentEvent"("tournament_id", "created_at");

-- AddForeignKey
ALTER TABLE "TournamentEvent" ADD CONSTRAINT "TournamentEvent_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
