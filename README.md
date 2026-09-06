# Quscer HRM Backend

Standalone NestJS + Prisma + PostgreSQL backend for Quscer HRM. Built to be
connected to Quscer OS later (WBS task 6.1 — shared user profile sync); until
then it owns its own `Organization` and `User` records.

This covers **Phase 1 (Shared Platform Foundation)** of the WBS — tenancy,
RBAC, audit log, branches/departments/cost-centres, jurisdiction/currency
settings, and the generic statutory rule engine, seeded with a first working
example endpoint.

## What's actually working right now

- `POST /auth/signup` — creates a new Organization + its first User in one
  call, auto-assigns the "HR Admin" system role, and returns a JWT. Requires
  the Permission catalog to already be seeded (`npm run prisma:seed`) — it
  fails loudly instead of silently creating a powerless user if you skip that.
- `POST /auth/login` — email/password against bcrypt hash, returns a JWT.
- `GET /organizations/me` — a real, guarded endpoint. Requires a valid JWT
  (`JwtAuthGuard`) and the `hrm.settings.write` permission (`PermissionGuard`,
  checked against the DB via Prisma) before returning the org + its locale
  settings + branches.
- **Employees (Phase 2 — complete):**
  - `POST /employees` — create, auto-inherits `countryCode`/`regionCode`
    from the branch if not given explicitly (so the payroll engine always
    has a jurisdiction to key off later)
  - `GET /employees` — searchable, paginated directory (WBS 2.12): filter by
    status/branch/department, search by name/email/employee number
  - `GET /employees/:id` — full profile incl. manager, direct reports,
    emergency contacts, documents, bank detail
  - `PATCH /employees/:id` — update, including status transitions
  - `GET /employees/:id/direct-reports` — one level of the manager hierarchy
    (WBS 2.6), enough to build an org chart view incrementally
  - `POST`/`DELETE /employees/:id/emergency-contacts[/:contactId]` (2.3)
  - `POST`/`DELETE /employees/:id/documents[/:documentId]` (2.5)
  - `PUT /employees/:id/bank-detail` — upsert, one per employee (2.3)
  - Every create/update writes an `AuditEvent` row (WBS 1.9)
- **Attendance (Phase 3 core):**
  - `POST /attendance/check-in` / `check-out` — self-service, resolves the
    logged-in User to their linked Employee record automatically
  - `POST /attendance/mark` — admin/manager marking someone else's day
    (raw write only — no correction/approval trail yet, that's 3.3)
  - `GET /attendance` — history, defaults to the caller's own record if no
    `employeeId` is passed, or look up someone else's with permission
- **Leave (Phase 3 core):**
  - `POST`/`GET /leave-types` — per-org leave-type catalog (3.8)
  - `POST /leave-requests` — self-service submission, day count computed
    inclusively (no weekend/holiday exclusion yet — see gaps below)
  - `GET /leave-requests` — filter by employee/status
  - `PATCH /leave-requests/:id/approve` / `reject` — approval deducts from
    `LeaveBalance` (creating a zero-allocation balance row on the fly if
    none exists, so missing setup shows up as a visible negative balance
    rather than silently blocking approval)
- The `StatutoryRule` table, seeded with Pakistan's income tax slabs, EOBI,
  and all four provincial social security schemes (PESSI/SESSI/KPESSI/BESSI)
  as data rows — not hardcoded logic. A second country pack later means new
  seed rows, not new code.
- **Payroll (Phase 4 core):**
  - `POST /employees/:id/salary-structure` — basic salary + arbitrary
    earning/deduction components (auto-creates the org-level component
    catalog entry the first time a name is used)
  - `POST /payroll-runs` — creates a run for a period and immediately
    calculates every ACTIVE employee's line item
  - `POST /payroll-runs/:id/recalculate` — DRAFT-only, safe to call
    repeatedly (rebuilds line items from scratch each time)
  - `POST /payroll-runs/:id/submit` → `POST /payroll-runs/:id/approve` —
    maker-checker (WBS 4.9), enforced by two separate permissions
    (`hrm.payroll.run` vs `hrm.payroll.approve`), not just a status flag
  - `GET /payroll-runs` / `GET /payroll-runs/:id` — list and full line-item
    detail
  - `POST`/`GET /employees/:id/loans` — loan creation and listing; active
    loans are automatically deducted during calculation and the balance is
    decremented **on approval**, not on calculation, so recalculating a
    draft never double-charges
  - **This is where the statutory engine (`statutory-engine.service.ts`)
    actually runs** — it reads `StatutoryRule` rows for the employee's
    `countryCode`/`regionCode` and the payroll period's date, and applies
    the matching formula. Every statutory line in a payslip's `breakdown`
    carries a `sourceRef` pointing to the exact rule row that produced it —
    a payslip is traceable to the rule version applied, not just a number.
  - `GET /payroll-runs/:id/my-payslip` — self-service PDF download, only
    once the run is APPROVED or LOCKED (a draft's numbers can still change,
    so employees never see a payslip that might be wrong tomorrow)
  - `GET /payroll-runs/:id/employees/:employeeId/payslip` — same PDF for
    HR/admin viewing someone else's, gated by `hrm.payroll.read`

The whole chain (signup → login → guarded request) is now testable end to end:

```bash
curl -X POST localhost:4100/auth/signup -H "Content-Type: application/json" -d '{
  "organizationName": "Test Co",
  "email": "admin@testco.com",
  "password": "changeme123",
  "firstName": "Ada",
  "lastName": "Admin"
}'
# -> { "accessToken": "..." }

curl -X POST localhost:4100/employees -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" -d '{
  "employeeNumber": "EMP-001",
  "firstName": "Bilal",
  "lastName": "Khan",
  "email": "bilal@testco.com",
  "designation": "Software Engineer",
  "dateOfJoining": "2026-08-01"
}'

curl "localhost:4100/employees?search=bilal" -H "Authorization: Bearer <accessToken>"
```

## What's NOT here yet (by design, matches the WBS phasing)

- **Auth is deliberately minimal** — no password reset, no email
  verification, no "invite a teammate to an existing org" flow (that's
  Phase 2's onboarding, task 2.8). This whole module is meant to be replaced
  by Quscer OS SSO validation once task 6.1 happens, not hardened further.
- **Bank account numbers are stored as plain text right now** — flagged with
  a `TODO: encrypt` comment on the field. Do not put real employee bank data
  in this before task 6.12 (field-level encryption) is built.
- **Employee lifecycle beyond the core record** — no onboarding checklist
  workflow (2.7), no offboarding/clearance workflow (2.9), no asset
  tracking (2.10), no letter templates (2.11), no bulk CSV import (2.13),
  no custom fields (2.14), no structured position/salary change history
  (2.15 — `AuditEvent` rows capture *that* something changed, not a
  before/after diff yet).
- **Attendance is check-in/out only** — no late/overtime calculation (3.4),
  no IP/geofence capture (3.5), no biometric device adapter (3.6, though the
  `AttendanceSource.BIOMETRIC` enum value is reserved for its output), no
  timesheets (3.7), no combined calendar (3.11), no regularization workflow
  for missed punches (3.12), no report APIs beyond the raw history endpoint
  (3.13). The "day boundary" is naively midnight UTC — a real multi-timezone
  deployment needs this to follow the employee's Branch timezone instead
  (flagged inline in `attendance.service.ts`).
- **Leave has no accrual/carry-forward engine** — `LeaveBalance` is a flat
  allocated-vs-used number per employee per year, set manually. No monthly
  accrual, no proration for mid-year joiners, no carry-forward rules (3.9).
  Day counts on requests don't exclude weekends/holidays (needs the org's
  holiday calendar, which isn't a queryable model yet). Approval is
  single-level only — no multi-level approval chains.
- **Payroll is core calculation + payslip PDFs only** — no bank transfer
  file export (4.11), no benefits/claims beyond salary components (4.13),
  no final settlement calculation (4.14), no accounting journal mapping
  (4.15 — blocked on the Invoicing connection anyway, task 6.4). The
  payslip PDF has no logo/branding/template customization yet (plain
  layout only). Payroll periods are assumed monthly — the income tax
  formula's annualization logic would need adjusting for weekly/bi-weekly
  runs (see the FlowHCM parity gap flagged earlier in the WBS).
- **The statutory formula interpreter only understands 3 shapes** (`slab`,
  `flat_percent_of_min_wage`, `percent_of_wage`) — exactly the shapes
  Pakistan's rules need. A second country whose tax system doesn't fit one
  of these (tiered federal+state+city, regime elections, phased-out
  rebates — see the Multi-Country Scaling Risks sheet in the WBS) will need
  a new shape added to `statutory-engine.service.ts`, and a malformed
  `StatutoryRule.formula` currently only fails at calculation time, not at
  write time — a Zod validation layer on write is still the right next step
  before scaling past one country.
- No Quscer OS connection — `quscerOrgId`/`quscerUserId` fields exist on the
  schema for that future sync but nothing populates them yet.

## Setup

```bash
npm install
cp .env.example .env   # fill in a real DATABASE_URL and JWT_SECRET
npx prisma migrate dev --name init
npx prisma db seed     # or: npm run prisma:seed
npm run start:dev
```

## Before this touches real payroll data

The seed script (`prisma/seed.ts`) has an explicit comment on this, but
worth repeating here: **the Pakistan tax slabs, social-security wage
ceilings, and minimum-wage figures are sourced from public references as of
Aug 2026 and are marked `VERIFY` in their `sourceRef` field.** Get a
Pakistani accountant or payroll professional to check every rate and slab
boundary against the current Finance Act and provincial notifications before
any of this runs a real employee's payroll — wrong money math is worse than
a bug that just crashes a page.

## Next steps, in order

1. Add a Zod (or class-validator) schema per `StatutoryRuleType` so a
   malformed rule fails at write-time, not payroll-run-time (see the
   Multi-Country Scaling Risks sheet in the WBS) — cheap now, expensive
   once there's real data riding on it.
2. Bank transfer file export (4.11) — the last "get the number out of the
   system" step; payslip PDFs are already done.
3. Encrypt `EmployeeBankDetail.accountNumber` (task 6.12) before any real
   bank data goes into this — now more urgent, since payroll actually runs.
4. Final settlement (4.14) — prorated calculation on termination, building
   on the same statutory engine.
5. Wire `quscerOrgId`/`quscerUserId` and build the sync job once this is
   ready to connect to Quscer OS (Phase 6, task 6.1) — at which point
   `src/auth/` gets replaced, not extended.
