-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "final_guest_factions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "final_host_factions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "guest_user_id" UUID,
ADD COLUMN     "host_user_id" UUID;

-- AlterTable
ALTER TABLE "DraftPreset" ADD COLUMN     "description" TEXT,
ADD COLUMN     "turn_seconds" INTEGER NOT NULL DEFAULT 30,
ALTER COLUMN "category_limits" SET DEFAULT '[]';

-- CreateTable
CREATE TABLE "DraftEvent" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "faction_id" TEXT,
    "is_auto_selected" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftEvent_draft_id_turn_index_idx" ON "DraftEvent"("draft_id", "turn_index");

-- CreateIndex
CREATE INDEX "DraftEvent_created_at_idx" ON "DraftEvent"("created_at");

-- CreateIndex
CREATE INDEX "Draft_host_user_id_idx" ON "Draft"("host_user_id");

-- CreateIndex
CREATE INDEX "Draft_guest_user_id_idx" ON "Draft"("guest_user_id");

-- AddForeignKey
ALTER TABLE "DraftEvent" ADD CONSTRAINT "DraftEvent_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
