// Seeds:
//   1. The HRM permission catalog (WBS 1.7)
//   2. Statutory rules for the Pakistan reference pack (WBS 4.4a / 4.5)
//
// NOTE ON THE PAKISTAN FIGURES: these are sourced from public references as
// of Aug 2026 (FY2025-26 budget cycle) — see sourceRef on each rule. Per the
// earlier recommendation, get a Pakistani accountant/payroll professional to
// verify every rate and slab below against the current Finance Act and
// provincial notifications BEFORE running real payroll on this data. This
// seed makes the numbers easy to find and update — it does not certify them.

import { PrismaClient, StatutoryRuleType } from '@prisma/client';

const prisma = new PrismaClient();

const HRM_PERMISSIONS = [
  { key: 'hrm.employee.read', description: 'View employee records' },
  { key: 'hrm.employee.write', description: 'Create/edit employee records' },
  { key: 'hrm.attendance.read', description: 'View attendance data' },
  { key: 'hrm.attendance.approve', description: 'Approve attendance corrections' },
  { key: 'hrm.leave.read', description: 'View leave requests/balances' },
  { key: 'hrm.leave.approve', description: 'Approve leave requests' },
  { key: 'hrm.payroll.read', description: 'View payroll data' },
  { key: 'hrm.payroll.write', description: 'Set/edit salary structures and loans' },
  { key: 'hrm.payroll.run', description: 'Run draft payroll' },
  { key: 'hrm.payroll.approve', description: 'Approve/lock a payroll run (maker-checker: separate from payroll.run)' },
  { key: 'hrm.reports.read', description: 'View HR/payroll reports' },
  { key: 'hrm.settings.write', description: 'Edit org-level HR/payroll settings' },
];

const DEFAULT_ROLES: Record<string, string[]> = {
  'HR Admin': [
    'hrm.employee.read', 'hrm.employee.write', 'hrm.attendance.read',
    'hrm.attendance.approve', 'hrm.leave.read', 'hrm.leave.approve',
    'hrm.payroll.read', 'hrm.payroll.write', 'hrm.reports.read', 'hrm.settings.write',
  ],
  'Payroll Approver': [
    'hrm.payroll.read', 'hrm.payroll.write', 'hrm.payroll.run', 'hrm.payroll.approve', 'hrm.reports.read',
  ],
  'Manager': [
    'hrm.employee.read', 'hrm.attendance.read', 'hrm.attendance.approve',
    'hrm.leave.read', 'hrm.leave.approve',
  ],
  'Employee': [
    'hrm.leave.read', 'hrm.attendance.read',
  ],
};

async function seedPermissions() {
  for (const perm of HRM_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm,
    });
  }
  console.log(`Seeded ${HRM_PERMISSIONS.length} permissions.`);
}

// Call this once per new organization (e.g. from an onboarding hook), not
// globally — Role is scoped to organizationId.
export async function seedDefaultRolesForOrg(organizationId: string) {
  for (const [roleName, permKeys] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.create({
      data: { organizationId, name: roleName, isSystemRole: true },
    });
    const perms = await prisma.permission.findMany({
      where: { key: { in: permKeys } },
    });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
}

async function seedPakistanStatutoryRules() {
  const effectiveFrom = new Date('2025-07-01'); // FY2025-26 tax year start

  // --- Income tax (FBR) — progressive slabs, salaried individuals ---
  await prisma.statutoryRule.create({
    data: {
      ruleType: StatutoryRuleType.INCOME_TAX,
      countryCode: 'PK',
      regionCode: null, // federal, applies nationwide
      effectiveFrom,
      formula: {
        type: 'slab',
        annualIncome: true,
        currency: 'PKR',
        slabs: [
          { upTo: 600000, rate: 0 },
          // NOTE: intermediate slab boundaries/rates need verification against
          // the actual FY2025-26 Finance Act before use — placeholder shape only.
          { upTo: 1200000, rate: 0.05 },
          { upTo: 2200000, rate: 0.15 },
          { upTo: 3200000, rate: 0.25 },
          { upTo: 4100000, rate: 0.30 },
          { upTo: null, rate: 0.35 }, // top slab, null = no upper bound
        ],
        surchargeThreshold: 10000000,
        surchargeRate: 0.09, // reduced from 10% to 9% in FY2025-26 budget
      },
      sourceRef: 'FY2025-26 Finance Act — VERIFY before production use',
    },
  });

  // --- EOBI (federal pension fund) — % of MINIMUM WAGE, not actual salary ---
  await prisma.statutoryRule.create({
    data: {
      ruleType: StatutoryRuleType.PENSION_FUND,
      countryCode: 'PK',
      regionCode: null,
      effectiveFrom,
      formula: {
        type: 'flat_percent_of_min_wage',
        employerPct: 0.05,
        employeePct: 0.01,
        minEstablishmentSize: 5, // only applies to establishments with 5+ employees
        eligibility: 'pakistani_nationals_only',
      },
      sourceRef: 'EOBI Act 1976, contribution rates effective 1 July 2025',
    },
  });

  // --- Provincial social security — 4 separate institutions ---
  const socialSecurityByRegion: Array<{
    regionCode: string;
    institution: string;
    employerPct: number;
  }> = [
    { regionCode: 'PB', institution: 'PESSI (Punjab)', employerPct: 0.06 },
    { regionCode: 'SD', institution: 'SESSI (Sindh)', employerPct: 0.06 },
    { regionCode: 'KP', institution: 'KPESSI (Khyber Pakhtunkhwa)', employerPct: 0.06 },
    { regionCode: 'BA', institution: 'BESSI (Balochistan)', employerPct: 0.06 },
  ];
  for (const region of socialSecurityByRegion) {
    await prisma.statutoryRule.create({
      data: {
        ruleType: StatutoryRuleType.SOCIAL_SECURITY,
        countryCode: 'PK',
        regionCode: region.regionCode,
        effectiveFrom,
        formula: {
          type: 'percent_of_wage',
          employerPct: region.employerPct,
          // wageCeiling varies by province and changes with each minimum-wage
          // revision — VERIFY the current notification before use, this is a
          // placeholder value from Sindh's most recent public figure.
          wageCeiling: 25000,
          institution: region.institution,
        },
        sourceRef: `${region.institution} — Provincial Employees Social Security Ordinance 1965, verify current ceiling`,
      },
    });
  }

  // --- Minimum wage by province/skill tier (2025-26) ---
  const minimumWages: Array<{ regionCode: string; skillTier: string; amount: number }> = [
    { regionCode: 'PB', skillTier: 'unskilled', amount: 40000 },
    { regionCode: 'SD', skillTier: 'unskilled', amount: 40000 },
    { regionCode: 'KP', skillTier: 'unskilled', amount: 40000 },
    { regionCode: 'BA', skillTier: 'unskilled', amount: 37000 },
    { regionCode: 'ICT', skillTier: 'unskilled', amount: 37000 },
    // Semi-skilled/skilled tiers sit higher than unskilled in every province —
    // add those rows once the exact provincial notifications are on hand.
  ];
  for (const wage of minimumWages) {
    await prisma.statutoryRule.create({
      data: {
        ruleType: StatutoryRuleType.MINIMUM_WAGE,
        countryCode: 'PK',
        regionCode: wage.regionCode,
        skillTier: wage.skillTier,
        effectiveFrom,
        formula: { type: 'flat_amount', amount: wage.amount, currency: 'PKR' },
        sourceRef: 'Provincial Minimum Wages Notifications, effective 1 July 2025',
      },
    });
  }

  console.log('Seeded Pakistan reference-pack statutory rules.');
}

async function main() {
  await seedPermissions();
  await seedPakistanStatutoryRules();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
