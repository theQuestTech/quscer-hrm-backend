-- CreateEnum
CREATE TYPE "BankChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "seq" INTEGER;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "requireTwoStepForAll" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "TwoStepBackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoStepBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingBankDetailChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountTitle" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "branchCode" TEXT,
    "status" "BankChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingBankDetailChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwoStepBackupCode_userId_idx" ON "TwoStepBackupCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");

-- CreateIndex
CREATE INDEX "PendingBankDetailChange_organizationId_status_idx" ON "PendingBankDetailChange"("organizationId", "status");


-- Activity record protection ------------------------------------------------
-- Every new AuditEvent gets a number per company and a SHA-256 hash covering
-- its contents and the previous entry's hash. Changing or deleting any entry
-- breaks the chain, which /activity/verify detects. Entries written before
-- this migration keep seq NULL and aren't part of the chain.

CREATE OR REPLACE FUNCTION audit_event_hash(
  org TEXT, seq INTEGER, actor TEXT, event_type TEXT, entity_type TEXT, entity_id TEXT,
  metadata JSONB, created_at TIMESTAMP(3), prev_hash TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    org, seq::text, coalesce(actor, ''), event_type, entity_type, entity_id,
    metadata::text, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS'), prev_hash
  ), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_event_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_seq INTEGER;
  last_hash TEXT;
BEGIN
  -- One writer per company at a time, so two entries never share a number.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW."organizationId"));
  SELECT "seq", "hash" INTO last_seq, last_hash FROM "AuditEvent"
    WHERE "organizationId" = NEW."organizationId" AND "seq" IS NOT NULL
    ORDER BY "seq" DESC LIMIT 1;
  NEW."seq" := coalesce(last_seq, 0) + 1;
  NEW."prevHash" := coalesce(last_hash, repeat('0', 64));
  NEW."createdAt" := date_trunc('milliseconds', coalesce(NEW."createdAt", now()));
  NEW."hash" := audit_event_hash(NEW."organizationId", NEW."seq", NEW."actorUserId", NEW."eventType",
    NEW."entityType", NEW."entityId", NEW."metadata"::jsonb, NEW."createdAt", NEW."prevHash");
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION audit_event_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The activity record cannot be changed or deleted';
END
$$;

CREATE TRIGGER audit_event_chain BEFORE INSERT ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_chain();
CREATE TRIGGER audit_event_readonly BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_readonly();
