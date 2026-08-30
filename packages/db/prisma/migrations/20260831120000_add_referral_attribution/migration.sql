-- Referral attribution: track where signups came from via ?ref= codes on links.
-- ReferralHit = append-only click log; TournamentParticipant.source = the ref that drove a
-- registration; User.referral_source = first-touch acquisition (how they first found the site).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "referral_source" TEXT;

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN "source" TEXT;

-- CreateTable
CREATE TABLE "ReferralHit" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "tournament_id" UUID,
    "user_id" UUID,
    "path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralHit_ref_idx" ON "ReferralHit"("ref");

-- CreateIndex
CREATE INDEX "ReferralHit_tournament_id_idx" ON "ReferralHit"("tournament_id");

-- CreateIndex
CREATE INDEX "ReferralHit_created_at_idx" ON "ReferralHit"("created_at");

-- AddForeignKey
ALTER TABLE "ReferralHit" ADD CONSTRAINT "ReferralHit_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralHit" ADD CONSTRAINT "ReferralHit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
