-- Optional in-game lobby password on a match game, paired with the existing lobby_code.
ALTER TABLE "MatchGame" ADD COLUMN "lobby_password" TEXT;
