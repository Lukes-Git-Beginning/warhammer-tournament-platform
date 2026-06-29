-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "standard_rules_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restrictions" TEXT NOT NULL DEFAULT '';
