-- AlterEnum: FACTION_WAR — a new tournament mode. Like SFT (single faction pre-picked at
-- registration), but each faction is globally exclusive: once a player claims a faction,
-- no other player in the tournament may pick it (enforced at pick time in the API). No new
-- column is needed — it reuses the existing TournamentParticipant.faction_id. Additive
-- value, not referenced in this migration, so it is safe to add in a transaction (same
-- pattern as the other TournamentMode additions).
ALTER TYPE "TournamentMode" ADD VALUE 'FACTION_WAR';
