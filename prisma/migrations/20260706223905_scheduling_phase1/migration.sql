-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "plannedMatchId" INTEGER;

-- AlterTable
ALTER TABLE "PlannedMatch" ADD COLUMN     "deadlineAt" TIMESTAMP(3),
ADD COLUMN     "forfeited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SchedulingSettings" (
    "id" SERIAL NOT NULL,
    "phase" "Phase" NOT NULL,
    "cycleLengthDays" INTEGER NOT NULL DEFAULT 14,
    "deadlineHoursBeforeCycleEnd" INTEGER NOT NULL DEFAULT 24,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutPeriod" (
    "id" SERIAL NOT NULL,
    "phase" "Phase" NOT NULL,
    "label" TEXT NOT NULL,
    "dateStart" TIMESTAMP(3) NOT NULL,
    "dateEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackoutPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingLog" (
    "id" SERIAL NOT NULL,
    "phase" "Phase" NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingSettings_phase_key" ON "SchedulingSettings"("phase");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_plannedMatchId_fkey" FOREIGN KEY ("plannedMatchId") REFERENCES "PlannedMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
