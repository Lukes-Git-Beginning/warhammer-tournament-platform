-- Ko-Fi supporter recognition: per-user tiers from Discord roles (synced) + admin manual override.
-- Effective tier per level = *_discord OR *_manual (see lib/supporter-status.ts).
ALTER TABLE "User" ADD COLUMN "supporter_discord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lord_discord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "champion_discord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "supporter_manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lord_manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "champion_manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "supporter_synced_at" TIMESTAMP(3);
