-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "cancelled_slot" UUID;
