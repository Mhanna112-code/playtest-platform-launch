-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outage" (
    "id" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "ms" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Heartbeat_at_idx" ON "Heartbeat"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Outage_startAt_key" ON "Outage"("startAt");

