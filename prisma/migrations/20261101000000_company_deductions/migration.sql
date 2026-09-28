-- CreateEnum
CREATE TYPE "CompanyDeductionMethod" AS ENUM ('PERCENT_OF_BASIC', 'PERCENT_OF_GROSS', 'FIXED_AMOUNT', 'TAX_SLABS');

-- CreateTable
CREATE TABLE "CompanyDeduction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT,
    "regionCode" TEXT,
    "method" "CompanyDeductionMethod" NOT NULL,
    "employeePercent" DECIMAL(65,30),
    "employerPercent" DECIMAL(65,30),
    "employeeAmount" DECIMAL(65,30),
    "employerAmount" DECIMAL(65,30),
    "wageCap" DECIMAL(65,30),
    "slabs" JSONB,
    "currency" TEXT,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
    "employeeIds" TEXT[],
    "reducesTaxablePay" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyDeduction_organizationId_idx" ON "CompanyDeduction"("organizationId");

-- AddForeignKey
ALTER TABLE "CompanyDeduction" ADD CONSTRAINT "CompanyDeduction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

