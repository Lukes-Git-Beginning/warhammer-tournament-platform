-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "onboarded_at" TIMESTAMP(3),
  ADD COLUMN "onboarding_stage" INTEGER NOT NULL DEFAULT 0;
