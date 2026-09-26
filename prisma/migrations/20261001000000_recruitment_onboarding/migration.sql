-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingAssignee" AS ENUM ('HR', 'MANAGER', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "careersSlug" TEXT;

-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "branchId" TEXT,
    "employmentType" "EmploymentType",
    "location" TEXT,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "salaryRange" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "closesAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "hiringManagerEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "currentCompany" TEXT,
    "expectedSalary" INTEGER,
    "noticePeriodDays" INTEGER,
    "coverNote" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CAREERS_PAGE',
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "rejectReason" TEXT,
    "notes" TEXT,
    "cvFileName" TEXT,
    "cvMimeType" TEXT,
    "cvSizeBytes" INTEGER,
    "offerDesignation" TEXT,
    "offerSalary" INTEGER,
    "offerJoiningDate" TIMESTAMP(3),
    "offerNotes" TEXT,
    "offerStatus" "OfferStatus",
    "offerSentAt" TIMESTAMP(3),
    "hiredEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplicationFile" (
    "applicationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "JobApplicationFile_pkey" PRIMARY KEY ("applicationId")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "mode" TEXT NOT NULL DEFAULT 'IN_PERSON',
    "location" TEXT,
    "interviewerEmployeeId" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "rating" INTEGER,
    "recommendation" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTaskTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" "OnboardingAssignee" NOT NULL,
    "dueDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" "OnboardingAssignee" NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOpening_organizationId_status_idx" ON "JobOpening"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_hiredEmployeeId_key" ON "JobApplication"("hiredEmployeeId");

-- CreateIndex
CREATE INDEX "JobApplication_organizationId_stage_idx" ON "JobApplication"("organizationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobId_email_key" ON "JobApplication"("jobId", "email");

-- CreateIndex
CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");

-- CreateIndex
CREATE INDEX "Interview_interviewerEmployeeId_status_idx" ON "Interview"("interviewerEmployeeId", "status");

-- CreateIndex
CREATE INDEX "OnboardingTaskTemplate_organizationId_idx" ON "OnboardingTaskTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "OnboardingTask_organizationId_doneAt_idx" ON "OnboardingTask"("organizationId", "doneAt");

-- CreateIndex
CREATE INDEX "OnboardingTask_employeeId_idx" ON "OnboardingTask"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_careersSlug_key" ON "Organization"("careersSlug");

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplicationFile" ADD CONSTRAINT "JobApplicationFile_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

