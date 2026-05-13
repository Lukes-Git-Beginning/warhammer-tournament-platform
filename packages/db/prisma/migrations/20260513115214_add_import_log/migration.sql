-- CreateTable
CREATE TABLE "ImportLog" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "records_imported" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportLog_source_started_at_idx" ON "ImportLog"("source", "started_at");
