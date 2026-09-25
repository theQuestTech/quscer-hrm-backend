-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveAccrual" AS ENUM ('ANNUAL', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'RETIREMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- AlterEnum
ALTER TYPE "LeaveRequestStatus" ADD VALUE 'FIRST_APPROVED';

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "earlyExitMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workedMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "exitDate" TIMESTAMP(3),
ADD COLUMN     "shiftId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeDocument" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ALTER COLUMN "fileUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LeaveBalance" ADD COLUMN     "isManualAllocation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "firstApprovedAt" TIMESTAMP(3),
ADD COLUMN     "firstApproverUserId" TEXT;

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "accrual" "LeaveAccrual" NOT NULL DEFAULT 'ANNUAL',
ADD COLUMN     "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isEncashable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxCarryForwardDays" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrganizationLocaleSettings" ADD COLUMN     "lateGraceMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "leaveApprovalSteps" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "EmployeeDocumentFile" (
    "documentId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "EmployeeDocumentFile_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalSettlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "lastWorkingDay" TIMESTAMP(3) NOT NULL,
    "reason" "ExitReason" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "totalEarnings" DECIMAL(65,30) NOT NULL,
    "totalDeductions" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceCorrection_organizationId_status_idx" ON "AttendanceCorrection"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_employeeId_idx" ON "AttendanceCorrection"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalSettlement_employeeId_key" ON "FinalSettlement"("employeeId");

-- CreateIndex
CREATE INDEX "FinalSettlement_organizationId_status_idx" ON "FinalSettlement"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentFile" ADD CONSTRAINT "EmployeeDocumentFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EmployeeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

