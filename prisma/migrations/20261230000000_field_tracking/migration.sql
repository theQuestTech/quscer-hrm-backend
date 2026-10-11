-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "fieldTrackingSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrganizationLocaleSettings" ADD COLUMN     "trackingIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "trackingKeepDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "fieldStaff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "battery" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "place" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationPing_organizationId_employeeId_at_idx" ON "LocationPing"("organizationId", "employeeId", "at");

-- CreateIndex
CREATE INDEX "LocationPing_at_idx" ON "LocationPing"("at");

-- CreateIndex
CREATE UNIQUE INDEX "LocationPing_employeeId_at_key" ON "LocationPing"("employeeId", "at");

-- CreateIndex
CREATE INDEX "FieldVisit_organizationId_employeeId_arrivedAt_idx" ON "FieldVisit"("organizationId", "employeeId", "arrivedAt");

-- CreateIndex
CREATE INDEX "TrackingEvent_organizationId_employeeId_at_idx" ON "TrackingEvent"("organizationId", "employeeId", "at");

