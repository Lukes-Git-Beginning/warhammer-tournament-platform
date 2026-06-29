-- CreateEnum
CREATE TYPE "QueueEventType" AS ENUM ('JOIN', 'LEAVE', 'MATCH', 'CANCEL', 'WIN', 'LOSE', 'DRAW');

-- CreateTable
CREATE TABLE "QueueActivityLog" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event" "QueueEventType" NOT NULL,
    "match_id" UUID,
    "opponent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueActivityLog_user_id_idx" ON "QueueActivityLog"("user_id");

-- CreateIndex
CREATE INDEX "QueueActivityLog_event_idx" ON "QueueActivityLog"("event");

-- CreateIndex
CREATE INDEX "QueueActivityLog_created_at_idx" ON "QueueActivityLog"("created_at");

-- AddForeignKey
ALTER TABLE "QueueActivityLog" ADD CONSTRAINT "QueueActivityLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueActivityLog" ADD CONSTRAINT "QueueActivityLog_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
