-- AlterEnum
ALTER TYPE "TournamentMode" ADD VALUE 'MATRIX';

-- CreateTable
CREATE TABLE "MatchFactionMatrix" (
    "game_id" UUID NOT NULL,
    "coin_flip_seed" TEXT NOT NULL DEFAULT '',
    "top_player_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "bottom_player_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "p1_factions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "p2_factions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "p1_locked_at" TIMESTAMP(3),
    "p2_locked_at" TIMESTAMP(3),
    "first_locked_at" TIMESTAMP(3),
    "revealed_at" TIMESTAMP(3),
    "bans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "picked_cell" TEXT,
    "last_action_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "MatchFactionMatrix_pkey" PRIMARY KEY ("game_id")
);

-- AddForeignKey
ALTER TABLE "MatchFactionMatrix" ADD CONSTRAINT "MatchFactionMatrix_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "MatchGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
