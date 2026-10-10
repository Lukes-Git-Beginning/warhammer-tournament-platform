-- Which tournaments a player wants the tournament-availability DM for (battle types + team sizes).
CREATE TABLE "UserTournamentNotifyPref" (
    "user_id" UUID NOT NULL,
    "battle_types" "BattleType"[] DEFAULT ARRAY['DOMINATION', 'CONQUEST', 'SIEGE']::"BattleType"[],
    "competitor_formats" "CompetitorFormat"[] DEFAULT ARRAY['ONE_V_ONE', 'TWO_V_TWO']::"CompetitorFormat"[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTournamentNotifyPref_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "UserTournamentNotifyPref" ADD CONSTRAINT "UserTournamentNotifyPref_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
