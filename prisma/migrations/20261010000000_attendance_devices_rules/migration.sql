-- CreateEnum
CREATE TYPE "AttendanceDeviceKind" AS ENUM ('ADMS', 'API', 'IMPORT');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "checkInInfo" JSONB,
ADD COLUMN     "checkOutInfo" JSONB;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "checkInMethod" TEXT,
ADD COLUMN     "machineUserId" TEXT,
ADD COLUMN     "requireOfficeLocation" BOOLEAN,
ADD COLUMN     "requireOfficeNetwork" BOOLEAN;

-- AlterTable
ALTER TABLE "OrganizationLocaleSettings" ADD COLUMN     "defaultCheckInMethod" TEXT NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "defaultRequireOfficeLocation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultRequireOfficeNetwork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AttendanceDeviceKind" NOT NULL,
    "serialNumber" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyHint" TEXT,
    "branchId" TEXT,
    "timezone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastPunchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "machineUserId" TEXT NOT NULL,
    "employeeId" TEXT,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "workDate" TIMESTAMP(3),
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeNetwork" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_key" ON "AttendanceDevice"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_apiKeyHash_key" ON "AttendanceDevice"("apiKeyHash");

-- CreateIndex
CREATE INDEX "AttendanceDevice_organizationId_idx" ON "AttendanceDevice"("organizationId");

-- CreateIndex
CREATE INDEX "AttendancePunch_organizationId_employeeId_workDate_idx" ON "AttendancePunch"("organizationId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "AttendancePunch_organizationId_employeeId_idx" ON "AttendancePunch"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_organizationId_machineUserId_punchedAt_key" ON "AttendancePunch"("organizationId", "machineUserId", "punchedAt");

-- CreateIndex
CREATE INDEX "OfficeNetwork_organizationId_idx" ON "OfficeNetwork"("organizationId");

-- CreateIndex
CREATE INDEX "OfficeLocation_organizationId_idx" ON "OfficeLocation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_key_key" ON "ReminderLog"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_machineUserId_key" ON "Employee"("organizationId", "machineUserId");

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

