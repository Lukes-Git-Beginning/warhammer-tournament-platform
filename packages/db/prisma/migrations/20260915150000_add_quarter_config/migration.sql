-- CreateTable
CREATE TABLE "QuarterConfig" (
    "period" TEXT NOT NULL,
    "name" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuarterConfig_pkey" PRIMARY KEY ("period")
);
