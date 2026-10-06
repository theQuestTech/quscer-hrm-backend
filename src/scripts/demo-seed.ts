/**
 * Demo company for staging: "Al-Noor Traders (Demo)" — the same made-up Karachi wholesaler
 * as the Quscer OS demo, here with its people: two branches, 25 staff, three months of
 * attendance and leave, payroll for each finished month, hiring, onboarding, training,
 * reviews and the company feed.
 *
 *   npm run build && npm run demo:seed -- --yes     (adds it if it isn't there)
 *   npm run demo:reset                              (deletes it and builds it again)
 *
 * Payroll goes through the app's own payroll code, so payslips, tax and EOBI/social
 * security come out exactly as they would for a real company. All names, CNICs, phone
 * numbers and bank accounts are made up; every address ends in .test and is never emailed.
 *
 * It refuses to run unless QUSCER_ENV=staging or the database is on this computer, so it
 * can never touch the live app's data.
 */
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { AttendanceSource, AttendanceStatus, EmploymentType, LeaveRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SetupService } from '../setup/setup.service';
import { EmployeesService } from '../employees/employees.service';
import { PayrollService } from '../payroll/payroll.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { RecruitmentService } from '../recruitment/recruitment.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { TrainingService } from '../training/training.service';
import { PerformanceService } from '../performance/performance.service';
import { FeedService } from '../feed/feed.service';
import { computeShiftMetrics } from '../attendance/shift-metrics';
import { normalizeBackupCode } from '../two-step/totp';
import { isStaging } from '../common/environment';

export const DEMO = {
  companyName: 'Al-Noor Traders (Demo)',
  password: 'Demo-Quscer-2026',
  // HR admin: needs two-step (payroll), with a fixed key so it can be added to an
  // authenticator app once — the same key as the Quscer OS demo owner.
  hr: { email: 'demo.hr@quscer.test', firstName: 'Ayesha', lastName: 'Siddiqui' },
  totpSecret: 'QUSCERDEMOAL2NOORTRADERSKHI34567',
  backupCodes: ['DEMO-AAAA', 'DEMO-BBBB', 'DEMO-CCCC', 'DEMO-DDDD', 'DEMO-EEEE', 'DEMO-FFFF', 'DEMO-GGGG', 'DEMO-HHHH', 'DEMO-JJJJ', 'DEMO-KKKK'],
  // No two-step needed for these two.
  manager: 'demo.manager@quscer.test',
  employee: 'demo.employee@quscer.test',
};

type App = Pick<INestApplicationContext, 'get'>;

let steps: string[] = [];
const log = (m: string) => {
  steps.push(m);
  console.log(`[demo] ${m}`);
};

export function assertSafeToSeed(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv) {
  const url = env.DATABASE_URL ?? '';
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) || /host=\/|host=localhost/.test(url);
  if (!isStaging(env) && !local) {
    throw new Error('Refusing to add demo data: set QUSCER_ENV=staging (staging only) — this database is not on this computer and may be the live one.');
  }
  if ((env.QUSCER_ENV ?? '').trim().toLowerCase() === 'production') throw new Error('Refusing to add demo data to production.');
  if (!argv.includes('--yes')) throw new Error('Add --yes to confirm (demo data is only for staging and local testing).');
}

// --- dates ---------------------------------------------------------------------------
const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monthStart = (d: Date, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
const monthEnd = (d: Date, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back + 1, 0));
// The company's own calendar day (Karachi is UTC+5).
const karachiToday = () => utcDay(new Date(Date.now() + 5 * 3600_000));
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

// A fixed sequence, so every build looks the same.
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// [number, first, last, designation, department, branch, salary Rs/month, joined (months ago), gender, manager?]
type Person = { no: string; first: string; last: string; title: string; dept: string; branch: 'KHI' | 'LHE'; salary: number; joinedMonthsAgo: number; gender: 'MALE' | 'FEMALE'; type?: EmploymentType; login?: string; isManager?: boolean };
const PEOPLE: Person[] = [
  { no: 'ANT-001', first: 'Bilal', last: 'Ahmed', title: 'Managing Director', dept: 'Management', branch: 'KHI', salary: 450000, joinedMonthsAgo: 96, gender: 'MALE', isManager: true },
  { no: 'ANT-002', first: 'Ayesha', last: 'Siddiqui', title: 'HR & Admin Manager', dept: 'HR & Admin', branch: 'KHI', salary: 220000, joinedMonthsAgo: 40, gender: 'FEMALE', login: 'hr' },
  { no: 'ANT-003', first: 'Kamran', last: 'Sheikh', title: 'Sales Manager', dept: 'Sales', branch: 'KHI', salary: 260000, joinedMonthsAgo: 62, gender: 'MALE', login: 'manager', isManager: true },
  { no: 'ANT-004', first: 'Farah', last: 'Naz', title: 'Accounts Manager', dept: 'Accounts', branch: 'KHI', salary: 240000, joinedMonthsAgo: 55, gender: 'FEMALE', isManager: true },
  { no: 'ANT-005', first: 'Imran', last: 'Qureshi', title: 'Warehouse Supervisor', dept: 'Warehouse', branch: 'KHI', salary: 130000, joinedMonthsAgo: 70, gender: 'MALE', isManager: true },
  { no: 'ANT-006', first: 'Usman', last: 'Tariq', title: 'Branch Manager', dept: 'Sales', branch: 'LHE', salary: 230000, joinedMonthsAgo: 30, gender: 'MALE', isManager: true },
  { no: 'ANT-007', first: 'Sana', last: 'Iqbal', title: 'Sales Officer', dept: 'Sales', branch: 'KHI', salary: 95000, joinedMonthsAgo: 26, gender: 'FEMALE', login: 'employee' },
  { no: 'ANT-008', first: 'Hamza', last: 'Malik', title: 'Sales Officer', dept: 'Sales', branch: 'KHI', salary: 90000, joinedMonthsAgo: 18, gender: 'MALE' },
  { no: 'ANT-009', first: 'Zainab', last: 'Raza', title: 'Sales Officer', dept: 'Sales', branch: 'KHI', salary: 88000, joinedMonthsAgo: 11, gender: 'FEMALE' },
  { no: 'ANT-010', first: 'Asif', last: 'Khan', title: 'Cashier', dept: 'Sales', branch: 'KHI', salary: 65000, joinedMonthsAgo: 34, gender: 'MALE' },
  { no: 'ANT-011', first: 'Nadia', last: 'Hussain', title: 'Accountant', dept: 'Accounts', branch: 'KHI', salary: 110000, joinedMonthsAgo: 22, gender: 'FEMALE' },
  { no: 'ANT-012', first: 'Faisal', last: 'Mehmood', title: 'Accounts Assistant', dept: 'Accounts', branch: 'KHI', salary: 70000, joinedMonthsAgo: 8, gender: 'MALE' },
  { no: 'ANT-013', first: 'Rashid', last: 'Ali', title: 'Store Keeper', dept: 'Warehouse', branch: 'KHI', salary: 60000, joinedMonthsAgo: 45, gender: 'MALE' },
  { no: 'ANT-014', first: 'Shahid', last: 'Baloch', title: 'Loader', dept: 'Warehouse', branch: 'KHI', salary: 42000, joinedMonthsAgo: 28, gender: 'MALE' },
  { no: 'ANT-015', first: 'Javed', last: 'Akhtar', title: 'Loader', dept: 'Warehouse', branch: 'KHI', salary: 42000, joinedMonthsAgo: 14, gender: 'MALE' },
  { no: 'ANT-016', first: 'Noman', last: 'Shah', title: 'Delivery Driver', dept: 'Delivery', branch: 'KHI', salary: 50000, joinedMonthsAgo: 38, gender: 'MALE' },
  { no: 'ANT-017', first: 'Waqas', last: 'Anwar', title: 'Delivery Driver', dept: 'Delivery', branch: 'KHI', salary: 50000, joinedMonthsAgo: 9, gender: 'MALE' },
  { no: 'ANT-018', first: 'Hira', last: 'Javed', title: 'HR Officer', dept: 'HR & Admin', branch: 'KHI', salary: 85000, joinedMonthsAgo: 16, gender: 'FEMALE' },
  { no: 'ANT-019', first: 'Adeel', last: 'Butt', title: 'Office Boy', dept: 'HR & Admin', branch: 'KHI', salary: 40000, joinedMonthsAgo: 50, gender: 'MALE' },
  { no: 'ANT-020', first: 'Maryam', last: 'Aslam', title: 'Sales Intern', dept: 'Sales', branch: 'KHI', salary: 30000, joinedMonthsAgo: 2, gender: 'FEMALE', type: 'INTERN' },
  { no: 'ANT-021', first: 'Ali', last: 'Haider', title: 'Sales Officer', dept: 'Sales', branch: 'LHE', salary: 90000, joinedMonthsAgo: 20, gender: 'MALE' },
  { no: 'ANT-022', first: 'Rabia', last: 'Saleem', title: 'Sales Officer', dept: 'Sales', branch: 'LHE', salary: 86000, joinedMonthsAgo: 7, gender: 'FEMALE' },
  { no: 'ANT-023', first: 'Tahir', last: 'Nawaz', title: 'Store Keeper', dept: 'Warehouse', branch: 'LHE', salary: 58000, joinedMonthsAgo: 24, gender: 'MALE' },
  { no: 'ANT-024', first: 'Saad', last: 'Rehman', title: 'Delivery Driver', dept: 'Delivery', branch: 'LHE', salary: 48000, joinedMonthsAgo: 12, gender: 'MALE' },
  { no: 'ANT-025', first: 'Iqra', last: 'Fatima', title: 'Accounts Assistant', dept: 'Accounts', branch: 'LHE', salary: 68000, joinedMonthsAgo: 1, gender: 'FEMALE' },
];
const BANKS = ['Meezan Bank', 'HBL', 'UBL', 'MCB Bank', 'Bank Alfalah', 'Allied Bank'];

/** Step 1: the company, the HR admin (two-step on, fixed key) and its set-up. */
async function company(app: App) {
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const setup = app.get(SetupService);
  const crypto = app.get(FieldEncryptionService);

  await auth.signup({ organizationName: DEMO.companyName, email: DEMO.hr.email, password: DEMO.password, firstName: DEMO.hr.firstName, lastName: DEMO.hr.lastName } as never);
  const hr = await prisma.user.findFirstOrThrow({ where: { email: DEMO.hr.email } });
  const organizationId = hr.organizationId;
  await prisma.user.update({ where: { id: hr.id }, data: { totpSecret: crypto.encrypt(DEMO.totpSecret), totpEnabledAt: new Date(), totpLastStep: null } });
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
  await prisma.twoStepBackupCode.createMany({ data: DEMO.backupCodes.map((c) => ({ userId: hr.id, codeHash: sha256(normalizeBackupCode(c)) })) });

  const khi = await setup.createBranch(organizationId, { name: 'Karachi Head Office', countryCode: 'PK', regionCode: 'SD', timezone: 'Asia/Karachi' } as never);
  const lhe = await setup.createBranch(organizationId, { name: 'Lahore Branch', countryCode: 'PK', regionCode: 'PB', timezone: 'Asia/Karachi' } as never);
  const depts: Record<string, string> = {};
  for (const name of ['Management', 'Sales', 'Accounts', 'Warehouse', 'Delivery', 'HR & Admin']) {
    depts[name] = (await setup.createDepartment(organizationId, { name } as never)).id;
  }
  const office = await setup.createShift(organizationId, { name: 'Office (9 to 6)', startTime: '09:00', endTime: '18:00' } as never);
  const warehouse = await setup.createShift(organizationId, { name: 'Warehouse (8 to 5)', startTime: '08:00', endTime: '17:00' } as never);

  // Public holidays in the demo's three months (dates as listed for 2026; check the year's notification).
  const year = new Date().getUTCFullYear();
  for (const [date, name] of [
    [`${year}-08-14`, 'Independence Day'],
    [`${year}-08-26`, 'Eid Milad-un-Nabi'],
    [`${year}-11-09`, 'Iqbal Day'],
    [`${year}-12-25`, 'Quaid-e-Azam Day'],
  ]) {
    await setup.createHoliday(organizationId, { date, name } as never);
  }
  log(`Company: ${DEMO.companyName} (${organizationId}) — 2 branches, 6 departments, 2 shifts, holidays`);
  return { organizationId, hrUserId: hr.id, branches: { KHI: khi.id, LHE: lhe.id }, depts, shifts: { office: office.id, warehouse: warehouse.id } };
}

/** Step 2: the staff, their pay, bank accounts and the three logins. */
async function people(app: App, c: Awaited<ReturnType<typeof company>>) {
  const prisma = app.get(PrismaService);
  const employees = app.get(EmployeesService);
  const payroll = app.get(PayrollService);
  const crypto = app.get(FieldEncryptionService);
  const today = karachiToday();
  const rnd = random(7);
  const ids: Record<string, string> = {};

  const roles = await prisma.role.findMany({ where: { organizationId: c.organizationId } });
  const roleId = (name: string) => roles.find((r) => r.name === name)!.id;

  for (const p of PEOPLE) {
    const joined = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - p.joinedMonthsAgo, 1 + Math.floor(rnd() * 20)));
    const managerNo = p.no === 'ANT-001' ? null : p.isManager ? 'ANT-001' : p.branch === 'LHE' ? 'ANT-006' : ({ Sales: 'ANT-003', Accounts: 'ANT-004', Warehouse: 'ANT-005', Delivery: 'ANT-005', 'HR & Admin': 'ANT-002' } as Record<string, string>)[p.dept];
    const n = parseInt(p.no.slice(4), 10);
    const e = await employees.create(c.organizationId, c.hrUserId, {
      employeeNumber: p.no,
      firstName: p.first,
      lastName: p.last,
      email: p.login === 'hr' ? DEMO.hr.email : p.login === 'manager' ? DEMO.manager : p.login === 'employee' ? DEMO.employee : `${p.first.toLowerCase()}.${p.last.toLowerCase()}@alnoor-demo.test`,
      phone: `0300-${String(1000000 + n * 7919).slice(-7)}`,
      designation: p.title,
      employmentType: p.type ?? 'FULL_TIME',
      dateOfJoining: iso(joined),
      dateOfBirth: `${1975 + ((n * 7) % 25)}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + ((n * 3) % 27)).padStart(2, '0')}`,
      probationEndDate: p.joinedMonthsAgo < 3 ? iso(addDays(joined, 90)) : undefined,
      contractEndDate: p.type === 'INTERN' ? iso(addDays(joined, 180)) : undefined,
      branchId: c.branches[p.branch],
      departmentId: c.depts[p.dept],
      managerId: managerNo ? ids[managerNo] : undefined,
      shiftId: p.dept === 'Warehouse' || p.dept === 'Delivery' ? c.shifts.warehouse : c.shifts.office,
      fatherName: `${['Muhammad', 'Abdul', 'Ghulam', 'Syed'][n % 4]} ${p.last}`,
      cnic: `${p.branch === 'KHI' ? '42101' : '35202'}-${String(1000000 + n * 104729).slice(-7)}-${n % 10}`,
      gender: p.gender,
      maritalStatus: n % 3 === 0 ? 'SINGLE' : 'MARRIED',
      bloodGroup: ['A+', 'B+', 'O+', 'AB+', 'O-'][n % 5],
      address: p.branch === 'KHI' ? `House ${n * 3}, Block ${1 + (n % 9)}, Gulshan-e-Iqbal, Karachi` : `House ${n * 5}, Model Town, Lahore`,
      city: p.branch === 'KHI' ? 'Karachi' : 'Lahore',
    } as never);
    ids[p.no] = e.id;

    // Pay: basic is 60% of gross, then house rent, medical and conveyance allowances.
    const basic = Math.round(p.salary * 0.6);
    const house = Math.round(p.salary * 0.27);
    const medical = Math.round(p.salary * 0.06);
    await payroll.upsertSalaryStructure(c.organizationId, e.id, {
      currency: 'PKR',
      basicSalary: basic,
      effectiveFrom: iso(joined),
      components: [
        { name: 'House Rent Allowance', type: 'EARNING', amount: house },
        { name: 'Medical Allowance', type: 'EARNING', amount: medical, isTaxable: false },
        { name: 'Conveyance Allowance', type: 'EARNING', amount: p.salary - basic - house - medical },
      ],
    });

    const account = String(10000000000000 + n * 7_654_321_123).slice(0, 14);
    await prisma.employeeBankDetail.create({
      data: { employeeId: e.id, bankName: BANKS[n % BANKS.length], accountTitle: `${p.first} ${p.last}`, branchCode: String(1000 + n * 37).slice(0, 4), accountNumber: crypto.encrypt(account), accountNumberLast4: account.slice(-4) },
    });
    await prisma.emergencyContact.create({ data: { employeeId: e.id, name: `${['Muhammad', 'Abdul', 'Ghulam', 'Syed'][n % 4]} ${p.last}`, relationship: n % 2 ? 'Father' : 'Spouse', phone: `0321-${String(2000000 + n * 6007).slice(-7)}` } as never });
  }

  // Logins: the HR admin's employee record joins her account; the manager and employee get their own.
  await prisma.employee.update({ where: { id: ids['ANT-002'] }, data: { userId: c.hrUserId } });
  const hash = await bcrypt.hash(DEMO.password, 10);
  for (const [no, email, role] of [
    ['ANT-003', DEMO.manager, 'Manager'],
    ['ANT-007', DEMO.employee, 'Employee'],
  ] as const) {
    const p = PEOPLE.find((x) => x.no === no)!;
    const user = await prisma.user.create({ data: { organizationId: c.organizationId, email, passwordHash: hash, firstName: p.first, lastName: p.last } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: c.organizationId } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: roleId(role), organizationId: c.organizationId, assignedById: c.hrUserId } });
    await prisma.employee.update({ where: { id: ids[no] }, data: { userId: user.id } });
  }
  const managerUserId = (await prisma.user.findFirstOrThrow({ where: { email: DEMO.manager } })).id;
  const employeeUserId = (await prisma.user.findFirstOrThrow({ where: { email: DEMO.employee } })).id;

  // A staff loan, paid back from salary.
  await payroll.createLoan(c.organizationId, ids['ANT-013'], { principal: 60000, installmentAmount: 10000, startDate: iso(monthStart(today, 3)), reason: 'Family wedding' } as never);
  log(`Staff: ${PEOPLE.length} people with pay, bank accounts and emergency contacts; 1 staff loan`);
  return { ids, managerUserId, employeeUserId };
}

/** Step 3: leave (approved, pending, rejected, one unpaid) and three months of attendance. */
async function leaveAndAttendance(app: App, c: Awaited<ReturnType<typeof company>>, staff: Awaited<ReturnType<typeof people>>) {
  const prisma = app.get(PrismaService);
  const today = karachiToday();
  const start = monthStart(today, 3);
  const types = await prisma.leaveType.findMany({ where: { organizationId: c.organizationId } });
  const type = (name: string) => types.find((t) => t.name === name)!;
  const holidays = new Set((await prisma.holiday.findMany({ where: { organizationId: c.organizationId } })).map((h) => iso(h.date)));
  const working = (d: Date) => !isWeekend(d) && !holidays.has(iso(d));
  const workdaysFrom = (from: Date, n: number) => {
    const out: Date[] = [];
    for (let d = from; out.length < n; d = addDays(d, 1)) if (working(d)) out.push(d);
    return out;
  };
  const hrEmp = staff.ids['ANT-002'];
  const managerEmp = staff.ids['ANT-003'];

  const onLeave = new Map<string, Set<string>>(); // employeeId -> days
  const leaves: [string, string, number, number, LeaveRequestStatus, string][] = [
    // [employee, type, starts (days after start), working days, status, reason]
    ['ANT-007', 'Annual', 20, 3, 'APPROVED', 'Family trip to Hunza'],
    ['ANT-008', 'Sick', 9, 2, 'APPROVED', 'Fever'],
    ['ANT-013', 'Casual', 33, 1, 'APPROVED', 'Bank work'],
    ['ANT-016', 'Unpaid', 41, 2, 'APPROVED', 'Village visit (no paid leave left)'],
    ['ANT-011', 'Annual', 52, 4, 'APPROVED', 'Sister’s wedding'],
    ['ANT-021', 'Sick', 60, 1, 'APPROVED', 'Doctor’s appointment'],
    ['ANT-014', 'Casual', 70, 1, 'REJECTED', 'Personal work (stock count day)'],
  ];
  for (const [no, typeName, offset, n, status, reason] of leaves) {
    const days = workdaysFrom(addDays(start, offset), n);
    const employeeId = staff.ids[no];
    const approver = no === 'ANT-007' || no === 'ANT-008' ? managerEmp : hrEmp;
    await prisma.leaveRequest.create({
      data: { organizationId: c.organizationId, employeeId, leaveTypeId: type(typeName).id, startDate: days[0], endDate: days[days.length - 1], days: n, reason, status, approverId: approver, decidedAt: addDays(days[0], -3), createdAt: addDays(days[0], -6) },
    });
    if (status === 'APPROVED') {
      await prisma.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type(typeName).id, year: days[0].getUTCFullYear() } },
        create: { employeeId, leaveTypeId: type(typeName).id, year: days[0].getUTCFullYear(), allocatedDays: 0, usedDays: n },
        update: { usedDays: { increment: n } },
      });
      onLeave.set(employeeId, new Set([...(onLeave.get(employeeId) ?? []), ...days.map(iso)]));
    }
  }
  // Waiting for a decision: one for the Sales manager (demo.manager), one for HR.
  for (const [no, typeName, n, reason] of [
    ['ANT-009', 'Annual', 2, 'Cousin’s wedding in Multan'],
    ['ANT-007', 'Casual', 1, 'Parent-teacher meeting'],
    ['ANT-023', 'Sick', 1, 'Dentist'],
  ] as const) {
    const days = workdaysFrom(addDays(today, 5), n);
    await prisma.leaveRequest.create({
      data: { organizationId: c.organizationId, employeeId: staff.ids[no], leaveTypeId: type(typeName).id, startDate: days[0], endDate: days[days.length - 1], days: n, reason, status: 'PENDING' },
    });
  }

  // Attendance: every working day up to today. Mostly on time; some late, some
  // overtime, a few absences; leave days marked as leave.
  const all = await prisma.employee.findMany({ where: { organizationId: c.organizationId }, include: { shift: true } });
  const rnd = random(42);
  const rows: Prisma.AttendanceRecordCreateManyInput[] = [];
  const now = Date.now();
  for (let d = start; d <= today; d = addDays(d, 1)) {
    if (!working(d)) continue;
    const isToday = d.getTime() === today.getTime();
    for (const e of all) {
      if (utcDay(e.dateOfJoining) > d) continue;
      if (onLeave.get(e.id)?.has(iso(d))) {
        rows.push({ organizationId: c.organizationId, employeeId: e.id, date: d, status: AttendanceStatus.ON_LEAVE, source: AttendanceSource.MANUAL });
        continue;
      }
      const r = rnd();
      if (r < 0.012) {
        rows.push({ organizationId: c.organizationId, employeeId: e.id, date: d, status: AttendanceStatus.ABSENT, source: AttendanceSource.MANUAL, notes: 'No show, no call' });
        continue;
      }
      const [sh, sm] = e.shift!.startTime.split(':').map(Number);
      const [eh, em] = e.shift!.endTime.split(':').map(Number);
      // Karachi is UTC+5: shift times are local.
      const lateBy = r < 0.1 ? 16 + Math.floor(rnd() * 50) : Math.floor(rnd() * 14) - 10;
      const checkIn = new Date(d.getTime() + ((sh - 5) * 60 + sm + lateBy) * 60000);
      // Today: those whose shift has started are checked in, nobody has left yet.
      if (isToday) {
        if (checkIn.getTime() > now) continue;
        const m = computeShiftMetrics({ day: d, shift: e.shift, timeZone: 'Asia/Karachi', checkIn, checkOut: null, graceMinutes: 15 });
        rows.push({ organizationId: c.organizationId, employeeId: e.id, date: d, checkIn, status: m.isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT, source: e.shiftId === c.shifts.warehouse ? AttendanceSource.BIOMETRIC : AttendanceSource.APP_CHECKIN, lateMinutes: m.lateMinutes });
        continue;
      }
      const stayed = r > 0.85 ? 30 + Math.floor(rnd() * 120) : Math.floor(rnd() * 20) - 5;
      const checkOut = new Date(d.getTime() + ((eh - 5) * 60 + em + stayed) * 60000);
      const m = computeShiftMetrics({ day: d, shift: e.shift, timeZone: 'Asia/Karachi', checkIn, checkOut, graceMinutes: 15 });
      rows.push({
        organizationId: c.organizationId,
        employeeId: e.id,
        date: d,
        checkIn,
        checkOut,
        status: m.isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        source: e.shiftId === c.shifts.warehouse ? AttendanceSource.BIOMETRIC : AttendanceSource.APP_CHECKIN,
        lateMinutes: m.lateMinutes,
        earlyExitMinutes: m.earlyExitMinutes,
        overtimeMinutes: m.overtimeMinutes,
        workedMinutes: m.workedMinutes,
      });
    }
  }
  await prisma.attendanceRecord.createMany({ data: rows });
  log(`Leave: ${leaves.length} decided requests, 3 waiting; attendance: ${rows.length} days recorded`);
}

/** Step 4: payroll for each finished month — the two older ones paid and locked, last month approved. */
async function runPayroll(app: App, c: Awaited<ReturnType<typeof company>>) {
  const payroll = app.get(PayrollService);
  const today = karachiToday();
  for (const back of [3, 2, 1]) {
    const periodStart = monthStart(today, back);
    const periodEnd = monthEnd(today, back);
    const run = await payroll.createRun(c.organizationId, c.hrUserId, { periodStart: iso(periodStart), periodEnd: iso(periodEnd), payDate: iso(addDays(periodEnd, 1)) });
    const runId = (run as { id?: string })?.id ?? (await app.get(PrismaService).payrollRun.findFirstOrThrow({ where: { organizationId: c.organizationId, periodStart } })).id;
    await payroll.submit(c.organizationId, c.hrUserId, runId);
    await payroll.approve(c.organizationId, c.hrUserId, runId);
    if (back > 1) await payroll.lock(c.organizationId, c.hrUserId, runId);
  }
  const lines = await app.get(PrismaService).payrollLineItem.count({ where: { payrollRun: { organizationId: c.organizationId } } });
  log(`Payroll: 3 months run through the payroll engine (${lines} payslips) — 2 locked, last month approved`);
}

/** Step 5: hiring, onboarding, training, reviews and the feed. */
async function theRest(app: App, c: Awaited<ReturnType<typeof company>>, staff: Awaited<ReturnType<typeof people>>) {
  const prisma = app.get(PrismaService);
  const hr = { id: c.hrUserId, organizationId: c.organizationId };
  const today = karachiToday();

  // Hiring: two open jobs with candidates at every stage.
  const recruitment = app.get(RecruitmentService);
  const jobs = [
    await recruitment.createJob(hr, { title: 'Sales Officer', departmentId: c.depts.Sales, branchId: c.branches.KHI, employmentType: 'FULL_TIME', location: 'Karachi', description: 'Visit retailers in your area, take orders and look after existing customers. Motorbike and fuel allowance provided.', requirements: 'Intermediate or above; 1+ year field sales; own motorbike licence.', salaryRange: 'Rs 80,000 – 100,000', openings: 2, status: 'OPEN', hiringManagerEmployeeId: staff.ids['ANT-003'] } as never),
    await recruitment.createJob(hr, { title: 'Warehouse Assistant', departmentId: c.depts.Warehouse, branchId: c.branches.LHE, employmentType: 'FULL_TIME', location: 'Lahore', description: 'Receive and dispatch stock, keep the store tidy and help with the monthly stock count.', salaryRange: 'Rs 45,000 – 55,000', openings: 1, status: 'OPEN' } as never),
  ] as { id: string }[];
  const candidates: [number, string, string, string, string, string][] = [
    [0, 'Owais', 'Ansari', 'APPLIED', 'Karachi', 'REFERRAL'],
    [0, 'Mahnoor', 'Khalid', 'SCREENING', 'Karachi', 'JOB_BOARD'],
    [0, 'Danish', 'Iqbal', 'INTERVIEW', 'Karachi', 'JOB_BOARD'],
    [0, 'Sobia', 'Rafiq', 'OFFER', 'Karachi', 'WALK_IN'],
    [0, 'Junaid', 'Akram', 'REJECTED', 'Hyderabad', 'EMAIL'],
    [1, 'Kashif', 'Mirza', 'APPLIED', 'Lahore', 'WALK_IN'],
    [1, 'Arslan', 'Javed', 'INTERVIEW', 'Lahore', 'REFERRAL'],
  ];
  let i = 0;
  for (const [job, first, last, stage, city, source] of candidates) {
    i++;
    const a = (await recruitment.addCandidate(hr, { jobId: jobs[job].id, firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@candidates-demo.test`, phone: `0333-${String(3000000 + i * 4211).slice(-7)}`, city, expectedSalary: job ? 50000 : 90000, noticePeriodDays: 30, source } as never, undefined)) as { id: string };
    if (stage === 'APPLIED') continue;
    await recruitment.move(hr, a.id, { stage: 'SCREENING' } as never);
    if (stage === 'SCREENING') continue;
    if (stage === 'REJECTED') {
      await recruitment.move(hr, a.id, { stage: 'REJECTED', rejectReason: 'Looking for a desk job' } as never);
      continue;
    }
    await recruitment.move(hr, a.id, { stage: 'INTERVIEW' } as never);
    const when = stage === 'INTERVIEW' ? addDays(today, 2 + i) : addDays(today, -7);
    const interview = (await recruitment.scheduleInterview(hr, a.id, { scheduledAt: new Date(when.getTime() + 6 * 3600_000).toISOString(), durationMinutes: 45, mode: 'IN_PERSON', location: 'Karachi Head Office', interviewerEmployeeId: job ? staff.ids['ANT-006'] : staff.ids['ANT-003'] } as never)) as { id: string };
    if (stage === 'OFFER') {
      await prisma.interview.update({ where: { id: interview.id }, data: { status: 'COMPLETED', rating: 5, recommendation: 'HIRE', feedback: 'Confident, knows the Saddar market well. Strong pick.' } as never }).catch(() => undefined);
      await recruitment.move(hr, a.id, { stage: 'OFFER' } as never);
      await recruitment.setOffer(hr, a.id, { designation: 'Sales Officer', salary: 92000, joiningDate: iso(addDays(today, 21)) } as never);
    }
  }

  // Onboarding: the standard checklist, started for the two newest joiners.
  const onboarding = app.get(OnboardingService);
  await onboarding.addSuggested(hr);
  for (const no of ['ANT-025', 'ANT-020']) await onboarding.startFor(c.organizationId, c.hrUserId, staff.ids[no]);
  const tasks = await prisma.onboardingTask.findMany({ where: { employeeId: staff.ids['ANT-020'] }, orderBy: { position: 'asc' } });
  for (const t of tasks.slice(0, Math.ceil(tasks.length * 0.7))) await prisma.onboardingTask.update({ where: { id: t.id }, data: { doneAt: new Date() } as never }).catch(() => undefined);

  // Training: a finished fire-safety class, an upcoming customer-service one, and a
  // forklift licence done outside.
  const training = app.get(TrainingService);
  const fire = (await training.createCourse(hr, { title: 'Fire Safety & First Aid', category: 'Health & Safety', provider: 'Rescue 1122 (Karachi)', delivery: 'CLASSROOM', durationHours: 4, costPerPerson: 2500, validityMonths: 12 } as never)) as { id: string };
  const service = (await training.createCourse(hr, { title: 'Handling Customers Well', category: 'Sales', provider: 'In-house', delivery: 'CLASSROOM', durationHours: 3 } as never)) as { id: string };
  const forklift = (await training.createCourse(hr, { title: 'Forklift Operator Licence', category: 'Warehouse', provider: 'NAVTTC', delivery: 'ON_THE_JOB', durationHours: 16, validityMonths: 24 } as never)) as { id: string };
  const warehouseStaff = ['ANT-005', 'ANT-013', 'ANT-014', 'ANT-015', 'ANT-016', 'ANT-017'].map((n) => staff.ids[n]);
  const fireDay = addDays(monthStart(today, 1), 9);
  const past = await prisma.trainingSession.create({ data: { courseId: fire.id, organizationId: c.organizationId, startsAt: new Date(fireDay.getTime() + 5 * 3600_000), endsAt: new Date(fireDay.getTime() + 9 * 3600_000), location: 'Warehouse, Karachi', trainer: 'Rescue 1122 team' } as never });
  for (const [k, employeeId] of warehouseStaff.entries()) {
    await prisma.trainingEnrolment.create({ data: { sessionId: past.id, employeeId, organizationId: c.organizationId, status: k === 4 ? 'NO_SHOW' : 'COMPLETED', score: k === 4 ? null : 70 + k * 5, completedAt: k === 4 ? null : fireDay } as never }).catch(() => undefined);
  }
  const next = (await training.createSession(hr, { courseId: service.id, startsAt: new Date(addDays(today, 10).getTime() + 6 * 3600_000).toISOString(), endsAt: new Date(addDays(today, 10).getTime() + 9 * 3600_000).toISOString(), location: 'Meeting room, Karachi Head Office', trainer: 'Kamran Sheikh', capacity: 12 } as never)) as { id: string };
  await training.enrol(hr, next.id, { employeeIds: ['ANT-007', 'ANT-008', 'ANT-009', 'ANT-010', 'ANT-020'].map((n) => staff.ids[n]) } as never);
  await training.recordExternal(hr, { employeeId: staff.ids['ANT-013'], courseId: forklift.id, completedAt: iso(addDays(today, -200)), hours: 16, score: 88 } as never);

  // Reviews: last quarter's cycle for Sales, with goals set by the manager.
  const performance = app.get(PerformanceService);
  const kpis = [
    (await performance.createKpi(hr, { name: 'Monthly sales vs target', measure: 'TARGET', unit: 'Rs lakh', defaultTarget: 40, defaultWeight: 50, higherIsBetter: true } as never)) as { id: string },
    (await performance.createKpi(hr, { name: 'Customer relationships', measure: 'RATING', defaultWeight: 30 } as never)) as { id: string },
    (await performance.createKpi(hr, { name: 'Attendance', measure: 'TARGET', unit: '%', defaultTarget: 95, defaultWeight: 20, auto: 'ATTENDANCE' } as never)) as { id: string },
  ];
  const cycle = (await performance.createCycle(hr, { name: `Q${Math.floor(monthStart(today, 3).getUTCMonth() / 3) + 1} ${monthStart(today, 3).getUTCFullYear()} review — Sales`, periodStart: iso(monthStart(today, 3)), periodEnd: iso(monthEnd(today, 1)) } as never)) as { id: string };
  await performance.launchCycle(hr, cycle.id, { departmentId: c.depts.Sales, kpiTemplateIds: kpis.map((k) => k.id) } as never);

  // Feed: a pinned announcement, news and a welcome, with likes and comments.
  const feed = app.get(FeedService);
  const manager = { id: staff.managerUserId, organizationId: c.organizationId };
  const employee = { id: staff.employeeUserId, organizationId: c.organizationId };
  const ann = (await feed.create(hr, { body: 'Reminder: the office is closed on public holidays listed under Holidays. Warehouse dispatch resumes at 8 am the next working day.', kind: 'ANNOUNCEMENT', pin: true })) as { id: string };
  const win = (await feed.create(manager, { body: 'Well done Sales team — we crossed Rs 1 crore in orders last month for the first time! Biryani on Friday 🎉' })) as { id: string };
  const welcome = (await feed.create(hr, { body: `Please welcome Iqra Fatima, who joins our Lahore accounts team this month. Say salaam when you see her!` })) as { id: string };
  await feed.like(employee, win.id, true);
  await feed.like(hr, win.id, true);
  await feed.like(employee, ann.id, true);
  await feed.addComment(employee, win.id, 'Thank you! Team effort 💪');
  await feed.addComment(manager, welcome.id, 'Welcome aboard, Iqra!');

  log('Hiring: 2 open jobs, 7 candidates; onboarding for 2 new joiners; 3 training courses; a Sales review cycle; 3 feed posts');
}

async function removeExisting(app: App) {
  const prisma = app.get(PrismaService);
  const org = await prisma.organization.findFirst({ where: { name: DEMO.companyName } });
  if (!org) return;
  const organizationId = org.id;
  const users = await prisma.user.findMany({ where: { OR: [{ organizationId }, { memberships: { some: { organizationId } } }] }, select: { id: true, email: true } });
  const userIds = users.filter((u) => u.email.endsWith('@quscer.test')).map((u) => u.id);
  const employeeIds = (await prisma.employee.findMany({ where: { organizationId }, select: { id: true } })).map((e) => e.id);
  const byOrg = { where: { organizationId } };
  const byEmp = { where: { employeeId: { in: employeeIds } } };
  // Children first; every table that points at the company or its people. The activity
  // record (AuditEvent) stays — the database refuses to delete it.
  await prisma.$transaction([
    prisma.feedLike.deleteMany({ where: { post: { organizationId } } }),
    prisma.feedComment.deleteMany({ where: { post: { organizationId } } }),
    prisma.feedImage.deleteMany({ where: { post: { organizationId } } }),
    prisma.feedPost.deleteMany(byOrg),
    prisma.reviewKpi.deleteMany({ where: { review: { organizationId } } }),
    prisma.performanceReview.deleteMany(byOrg),
    prisma.reviewCycle.deleteMany(byOrg),
    prisma.kpiTemplate.deleteMany(byOrg),
    prisma.trainingEnrolment.deleteMany(byEmp),
    prisma.trainingRequest.deleteMany(byEmp),
    prisma.trainingSession.deleteMany({ where: { course: { organizationId } } }),
    prisma.trainingCourse.deleteMany(byOrg),
    prisma.onboardingTask.deleteMany(byOrg),
    prisma.onboardingTaskTemplate.deleteMany(byOrg),
    prisma.interview.deleteMany({ where: { application: { job: { organizationId } } } }),
    prisma.jobApplicationFile.deleteMany({ where: { application: { job: { organizationId } } } }),
    prisma.jobApplication.deleteMany({ where: { job: { organizationId } } }),
    prisma.jobOpening.deleteMany(byOrg),
    prisma.payrollLineItem.deleteMany({ where: { payrollRun: { organizationId } } }),
    prisma.payrollRun.deleteMany(byOrg),
    prisma.employeeLoan.deleteMany(byEmp),
    prisma.employeeSalaryComponent.deleteMany({ where: { salaryStructure: { employeeId: { in: employeeIds } } } }),
    prisma.employeeSalaryStructure.deleteMany(byEmp),
    prisma.finalSettlement.deleteMany(byEmp),
    prisma.attendanceCorrection.deleteMany(byEmp),
    prisma.attendancePunch.deleteMany(byOrg),
    prisma.attendanceRecord.deleteMany(byEmp),
    prisma.leaveRequest.deleteMany(byEmp),
    prisma.leaveBalance.deleteMany(byEmp),
    prisma.pendingBankDetailChange.deleteMany(byEmp),
    prisma.employeeBankDetail.deleteMany(byEmp),
    prisma.employeeDocumentFile.deleteMany({ where: { document: { employeeId: { in: employeeIds } } } }),
    prisma.employeeDocument.deleteMany(byEmp),
    prisma.employeePhoto.deleteMany(byEmp),
    prisma.emergencyContact.deleteMany(byEmp),
    prisma.employee.updateMany({ where: { organizationId }, data: { managerId: null } }),
    prisma.employee.deleteMany(byOrg),
    prisma.leaveType.deleteMany(byOrg),
    prisma.salaryComponent.deleteMany(byOrg),
    prisma.companyDeduction.deleteMany(byOrg),
    prisma.holiday.deleteMany(byOrg),
    prisma.shift.deleteMany(byOrg),
    prisma.costCentre.deleteMany(byOrg),
    prisma.department.deleteMany(byOrg),
    prisma.branch.deleteMany(byOrg),
    prisma.officeNetwork.deleteMany(byOrg),
    prisma.officeLocation.deleteMany(byOrg),
    prisma.attendanceDevice.deleteMany(byOrg),
    prisma.supportMessage.deleteMany({ where: { ticket: { organizationId } } }),
    prisma.supportTicket.deleteMany(byOrg),
    prisma.supportViewSession.deleteMany(byOrg),
    prisma.userRoleAssignment.deleteMany(byOrg),
    prisma.rolePermission.deleteMany({ where: { role: { organizationId } } }),
    prisma.role.deleteMany(byOrg),
    prisma.membership.deleteMany(byOrg),
    prisma.twoStepBackupCode.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.trustedDevice.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.membership.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.organizationLocaleSettings.deleteMany(byOrg),
    // The activity record can't be deleted (by design), so the emptied company stays,
    // renamed and suspended, with its history.
    prisma.organization.update({
      where: { id: organizationId },
      data: { name: `Old demo — replaced ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, suspendedAt: new Date(), suspendedReason: 'Demo rebuilt', careersSlug: null },
    }),
  ]);
  log('Cleared the old demo company (kept, renamed and suspended, with its activity record)');
}

export async function buildDemo(app: App, opts: { reset: boolean }) {
  steps = [];
  const prisma = app.get(PrismaService);
  if (opts.reset) await removeExisting(app);
  else if (await prisma.organization.findFirst({ where: { name: DEMO.companyName } })) {
    log('The demo company is already there — add --reset to build it again.');
    return { built: false, steps };
  }
  const c = await company(app);
  const staff = await people(app, c);
  await leaveAndAttendance(app, c, staff);
  await runPayroll(app, c);
  await theRest(app, c, staff);
  log(`Done. HR admin: ${DEMO.hr.email} / ${DEMO.password} (authenticator key ${DEMO.totpSecret})`);
  log(`Manager: ${DEMO.manager}, employee: ${DEMO.employee} — same password, no two-step`);
  return { built: true, organizationId: c.organizationId, steps };
}

async function main() {
  assertSafeToSeed();
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await buildDemo(app, { reset: process.argv.includes('--reset') });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
