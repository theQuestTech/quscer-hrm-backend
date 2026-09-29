-- Two-step sign-in for support staff (always required), a checkpoint so the
-- activity check only reads new entries, and an index that keeps finding a
-- company's last activity entry quick (used by the audit_event_chain trigger).

-- AlterTable
ALTER TABLE "SupportAgent" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "AuditCheckpoint" (
    "organizationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fullCheckedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCheckpoint_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "SupportAgentBackupCode" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAgentBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportAgentBackupCode_agentId_idx" ON "SupportAgentBackupCode"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_organizationId_seq_key" ON "AuditEvent"("organizationId", "seq");

-- AddForeignKey
ALTER TABLE "SupportAgentBackupCode" ADD CONSTRAINT "SupportAgentBackupCode_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SupportAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

