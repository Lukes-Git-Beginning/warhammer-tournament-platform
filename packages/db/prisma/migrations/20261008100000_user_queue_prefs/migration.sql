-- Persistent Open Play queue settings per player.
CREATE TABLE "UserQueuePref" (
    "user_id" UUID NOT NULL,
    "battle_types" "BattleType"[] DEFAULT ARRAY['DOMINATION', 'CONQUEST', 'SIEGE']::"BattleType"[],
    "match_formats" "MatchFormat"[] DEFAULT ARRAY['BO1', 'BO3']::"MatchFormat"[],
    "competitor_format" "CompetitorFormat" NOT NULL DEFAULT 'ONE_V_ONE',
    "team_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserQueuePref_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "UserQueuePref" ADD CONSTRAINT "UserQueuePref_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
