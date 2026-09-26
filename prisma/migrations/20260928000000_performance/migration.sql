-- CreateEnum
CREATE TYPE "KpiMeasure" AS ENUM ('RATING', 'TARGET');

-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewStage" AS ENUM ('GOALS', 'SELF', 'MANAGER', 'DONE');

-- AlterTable
ALTER TABLE "OrganizationLocaleSettings" ADD COLUMN     "enabledModules" TEXT[] DEFAULT ARRAY['performance', 'training', 'recruitment']::TEXT[],
ADD COLUMN     "kpiScoring" TEXT NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "selfReviewEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "KpiTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "measure" "KpiMeasure" NOT NULL,
    "unit" TEXT,
    "defaultTarget" DOUBLE PRECISION,
    "defaultWeight" INTEGER NOT NULL DEFAULT 20,
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "auto" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT,
    "stage" "ReviewStage" NOT NULL DEFAULT 'GOALS',
    "selfComment" TEXT,
    "managerComment" TEXT,
    "finalScore" DOUBLE PRECISION,
    "selfSubmittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewKpi" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "measure" "KpiMeasure" NOT NULL,
    "unit" TEXT,
    "target" DOUBLE PRECISION,
    "weight" INTEGER NOT NULL,
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "auto" TEXT,
    "actual" DOUBLE PRECISION,
    "selfRating" INTEGER,
    "managerRating" INTEGER,
    "selfNote" TEXT,
    "managerNote" TEXT,

    CONSTRAINT "ReviewKpi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KpiTemplate_organizationId_idx" ON "KpiTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "ReviewCycle_organizationId_idx" ON "ReviewCycle"("organizationId");

-- CreateIndex
CREATE INDEX "PerformanceReview_organizationId_idx" ON "PerformanceReview"("organizationId");

-- CreateIndex
CREATE INDEX "PerformanceReview_reviewerEmployeeId_idx" ON "PerformanceReview"("reviewerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_cycleId_employeeId_key" ON "PerformanceReview"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "ReviewKpi_reviewId_idx" ON "ReviewKpi"("reviewId");

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewKpi" ADD CONSTRAINT "ReviewKpi_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PerformanceReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

