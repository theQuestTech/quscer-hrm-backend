// Bulk employee import: turns the rows of HR's spreadsheet into employee
// records, with a plain reason for every row that can't be used. Free of the
// database so the rules are easy to test; EmployeeImportService looks up the
// company's branches, departments, shifts and existing people.

import { EmploymentType } from '@prisma/client';

// One spreadsheet row, every cell as text (the screen sends what it read).
export type ImportRow = Record<string, string | undefined>;

// Columns, in template order. Header names are matched loosely (case, spaces
// and punctuation ignored), with a few common alternatives.
export const COLUMNS: { key: string; header: string; required?: boolean; aliases?: string[] }[] = [
  { key: 'employeeNumber', header: 'Employee number', required: true, aliases: ['emp no', 'employee no', 'employee id', 'emp id', 'staff no'] },
  { key: 'firstName', header: 'First name', required: true },
  { key: 'lastName', header: 'Last name', required: true, aliases: ['surname'] },
  { key: 'email', header: 'Work email', required: true, aliases: ['email', 'email address'] },
  { key: 'designation', header: 'Job title', required: true, aliases: ['designation', 'position', 'title'] },
  { key: 'dateOfJoining', header: 'Joining date', required: true, aliases: ['date of joining', 'doj', 'joined'] },
  { key: 'phone', header: 'Phone', aliases: ['mobile', 'cell', 'phone number'] },
  { key: 'employmentType', header: 'Employment type', aliases: ['type'] },
  { key: 'branch', header: 'Branch', aliases: ['location', 'office'] },
  { key: 'department', header: 'Department', aliases: ['dept'] },
  { key: 'managerNumber', header: 'Manager employee number', aliases: ['manager', 'manager number', 'reports to', 'line manager'] },
  { key: 'shift', header: 'Shift' },
  { key: 'cnic', header: 'CNIC', aliases: ['cnic number', 'nic'] },
  { key: 'fatherName', header: "Father's name", aliases: ['father name', 'father husband name'] },
  { key: 'dateOfBirth', header: 'Date of birth', aliases: ['dob', 'birth date'] },
  { key: 'gender', header: 'Gender' },
  { key: 'maritalStatus', header: 'Marital status' },
  { key: 'bloodGroup', header: 'Blood group' },
  { key: 'personalEmail', header: 'Personal email' },
  { key: 'address', header: 'Home address', aliases: ['address'] },
  { key: 'city', header: 'City' },
  { key: 'machineUserId', header: 'Attendance machine ID', aliases: ['machine id', 'biometric id'] },
  { key: 'basicSalary', header: 'Monthly basic salary', aliases: ['basic salary', 'basic', 'salary'] },
  { key: 'bankName', header: 'Bank name', aliases: ['bank'] },
  { key: 'accountTitle', header: 'Account title' },
  { key: 'accountNumber', header: 'Account number / IBAN', aliases: ['account number', 'iban', 'account no'] },
  { key: 'bankBranchCode', header: 'Bank branch code', aliases: ['branch code'] },
];

export const MAX_ROWS = 2000;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Header text → column key, or undefined if it isn't one of ours.
export function columnFor(header: string): string | undefined {
  const h = squash(header);
  if (!h) return undefined;
  return COLUMNS.find((c) => squash(c.header) === h || squash(c.key) === h || c.aliases?.some((a) => squash(a) === h))?.key;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "2024-03-01", "01/03/2024", "1-3-2024", "1 Mar 2024", "01-Mar-24" → "2024-03-01".
// Numbers-only dates are read day first, as written in Pakistan.
export function parseDate(value: string | undefined): string | undefined {
  const t = value?.trim();
  if (!t) return undefined;
  const iso = (y: number, m: number, d: number) => {
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ,]+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return iso(+m[3], month, +m[1]);
  }
  return undefined;
}

// "3520212345671" or "35202-1234567-1" → "35202-1234567-1".
export function normaliseCnic(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length !== 13) return undefined;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

const TYPES: Record<string, EmploymentType> = {
  fulltime: EmploymentType.FULL_TIME, permanent: EmploymentType.FULL_TIME,
  parttime: EmploymentType.PART_TIME,
  contract: EmploymentType.CONTRACT, contractual: EmploymentType.CONTRACT,
  intern: EmploymentType.INTERN, internship: EmploymentType.INTERN, trainee: EmploymentType.INTERN,
};
const GENDERS: Record<string, string> = { male: 'MALE', m: 'MALE', female: 'FEMALE', f: 'FEMALE', other: 'OTHER' };
const MARITAL: Record<string, string> = { single: 'SINGLE', unmarried: 'SINGLE', married: 'MARRIED', divorced: 'DIVORCED', widowed: 'WIDOWED', widow: 'WIDOWED' };
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What the company already has, for matching names and spotting repeats.
export interface ImportLookups {
  branches: { id: string; name: string }[];
  departments: { id: string; name: string; branchId: string | null }[];
  shifts: { id: string; name: string }[];
  existing: { id: string; employeeNumber: string; email: string; cnic: string | null; machineUserId: string | null }[];
}

export interface CheckedRow {
  line: number; // spreadsheet line, header = 1
  employeeNumber: string;
  name: string;
  problems: string[];
  warnings: string[];
  data?: {
    employeeNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    designation: string;
    dateOfJoining: string;
    phone?: string;
    employmentType?: EmploymentType;
    branchId?: string;
    departmentId?: string;
    shiftId?: string;
    managerNumber?: string;
    cnic?: string;
    fatherName?: string;
    dateOfBirth?: string;
    gender?: string;
    maritalStatus?: string;
    bloodGroup?: string;
    personalEmail?: string;
    address?: string;
    city?: string;
    machineUserId?: string;
    basicSalary?: number;
    bank?: { bankName: string; accountTitle: string; accountNumber: string; branchCode?: string };
  };
}

// Checks every row. A row with any problem can't be imported; warnings are
// things worth a look that don't stop it.
export function checkRows(rows: ImportRow[], lookups: ImportLookups, today = new Date()): CheckedRow[] {
  const lower = (s?: string | null) => (s ?? '').trim().toLowerCase();
  const byName = <T extends { name: string }>(list: T[], name: string) => list.filter((x) => lower(x.name) === lower(name));
  const existingNumbers = new Set(lookups.existing.map((e) => lower(e.employeeNumber)));
  const existingEmails = new Set(lookups.existing.map((e) => lower(e.email)));
  const existingCnics = new Set(lookups.existing.map((e) => e.cnic).filter(Boolean));
  const existingMachine = new Set(lookups.existing.map((e) => lower(e.machineUserId)).filter(Boolean));

  // Repeats inside the file.
  const count = (key: (r: ImportRow) => string | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const fileNumbers = count((r) => lower(r.employeeNumber) || undefined);
  const fileEmails = count((r) => lower(r.email) || undefined);
  const fileCnics = count((r) => normaliseCnic(r.cnic));
  const fileMachine = count((r) => lower(r.machineUserId) || undefined);
  const todayIso = today.toISOString().slice(0, 10);

  const out = rows.map((r, i): CheckedRow => {
    const v = (k: string) => r[k]?.toString().trim() || undefined;
    const problems: string[] = [];
    const warnings: string[] = [];
    const number = v('employeeNumber') ?? '';
    const firstName = v('firstName') ?? '';
    const lastName = v('lastName') ?? '';
    const email = lower(v('email'));
    const designation = v('designation') ?? '';

    for (const c of COLUMNS.filter((c) => c.required)) if (!v(c.key)) problems.push(`${c.header} is missing`);
    if (number && number.length > 40) problems.push('Employee number is too long (40 characters at most)');
    if (number && existingNumbers.has(lower(number))) problems.push(`Employee number ${number} is already used in this company`);
    if (number && (fileNumbers.get(lower(number)) ?? 0) > 1) problems.push(`Employee number ${number} appears more than once in the file`);
    if (email && !EMAIL.test(email)) problems.push(`Work email "${v('email')}" doesn't look right`);
    if (email && existingEmails.has(email)) problems.push(`${email} is already used by another employee`);
    if (email && (fileEmails.get(email) ?? 0) > 1) problems.push(`${email} appears more than once in the file`);

    const dateOfJoining = parseDate(v('dateOfJoining'));
    if (v('dateOfJoining') && !dateOfJoining) problems.push(`Joining date "${v('dateOfJoining')}" isn't a date we can read — use 2024-03-01 or 01/03/2024`);

    const data: NonNullable<CheckedRow['data']> = {
      employeeNumber: number,
      firstName,
      lastName,
      email,
      designation,
      dateOfJoining: dateOfJoining ?? '',
      phone: v('phone'),
    };

    if (v('employmentType')) {
      const t = TYPES[squash(v('employmentType')!)];
      if (t) data.employmentType = t;
      else problems.push(`Employment type "${v('employmentType')}" — use Full time, Part time, Contract or Intern`);
    }

    if (v('branch')) {
      const found = byName(lookups.branches, v('branch')!);
      if (found.length) data.branchId = found[0].id;
      else problems.push(`Branch "${v('branch')}" not found — add it in Settings → Branches first, or fix the spelling`);
    }
    if (v('department')) {
      const found = byName(lookups.departments, v('department')!);
      const pick = found.find((d) => !d.branchId || d.branchId === data.branchId) ?? found[0];
      if (pick) data.departmentId = pick.id;
      else problems.push(`Department "${v('department')}" not found — add it in Settings → Departments first`);
    }
    if (v('shift')) {
      const found = byName(lookups.shifts, v('shift')!);
      if (found.length) data.shiftId = found[0].id;
      else problems.push(`Shift "${v('shift')}" not found — add it in Settings → Shifts first`);
    }
    if (v('managerNumber')) {
      const m = v('managerNumber')!;
      if (lower(m) === lower(number)) problems.push("Someone can't be their own manager");
      else if (!existingNumbers.has(lower(m)) && !fileNumbers.has(lower(m))) problems.push(`Manager ${m} isn't an employee here or in the file`);
      else data.managerNumber = m;
    }

    if (v('cnic')) {
      const cnic = normaliseCnic(v('cnic'));
      if (!cnic) problems.push(`CNIC "${v('cnic')}" should have 13 digits, like 35202-1234567-1`);
      else {
        data.cnic = cnic;
        if (existingCnics.has(cnic)) problems.push(`CNIC ${cnic} already belongs to another employee`);
        if ((fileCnics.get(cnic) ?? 0) > 1) problems.push(`CNIC ${cnic} appears more than once in the file`);
      }
    }
    data.fatherName = v('fatherName');
    if (v('dateOfBirth')) {
      const dob = parseDate(v('dateOfBirth'));
      if (!dob) problems.push(`Date of birth "${v('dateOfBirth')}" isn't a date we can read`);
      else if (dob >= todayIso) problems.push('Date of birth is in the future');
      else data.dateOfBirth = dob;
    }
    if (dateOfJoining && dateOfJoining > todayIso) warnings.push('Joining date is in the future');
    if (v('gender')) {
      const g = GENDERS[lower(v('gender'))];
      if (g) data.gender = g;
      else problems.push(`Gender "${v('gender')}" — use Male, Female or Other`);
    }
    if (v('maritalStatus')) {
      const s = MARITAL[lower(v('maritalStatus'))];
      if (s) data.maritalStatus = s;
      else problems.push(`Marital status "${v('maritalStatus')}" — use Single, Married, Divorced or Widowed`);
    }
    if (v('bloodGroup')) {
      // "B positive", "b+ve", "O NEG" → B+, B+, O-
      const b = v('bloodGroup')!.toUpperCase().replace(/\s/g, '').replace(/POS(ITIVE)?$/, '+').replace(/NEG(ATIVE)?$/, '-').replace(/([+-])VE$/, '$1');
      if (BLOOD.includes(b)) data.bloodGroup = b;
      else problems.push(`Blood group "${v('bloodGroup')}" — use A+, B-, O+ and so on`);
    }
    if (v('personalEmail')) {
      if (EMAIL.test(v('personalEmail')!)) data.personalEmail = v('personalEmail');
      else problems.push(`Personal email "${v('personalEmail')}" doesn't look right`);
    }
    if (v('address') && v('address')!.length > 300) problems.push('Home address is too long (300 characters at most)');
    data.address = v('address');
    data.city = v('city');
    if (v('machineUserId')) {
      const id = v('machineUserId')!;
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) problems.push('Attendance machine ID can only have letters, numbers, - and _');
      else if (existingMachine.has(lower(id))) problems.push(`Attendance machine ID ${id} is already given to someone else`);
      else if ((fileMachine.get(lower(id)) ?? 0) > 1) problems.push(`Attendance machine ID ${id} appears more than once in the file`);
      else data.machineUserId = id;
    }
    if (v('basicSalary')) {
      const n = Number(v('basicSalary')!.replace(/,|rs\.?|pkr/gi, '').trim());
      if (!Number.isFinite(n) || n <= 0) problems.push(`Monthly basic salary "${v('basicSalary')}" isn't an amount`);
      else data.basicSalary = Math.round(n * 100) / 100;
    }
    const bankCells = ['bankName', 'accountTitle', 'accountNumber'].map(v);
    if (bankCells.some(Boolean)) {
      if (!bankCells.every(Boolean)) problems.push('Bank details need all three: bank name, account title and account number / IBAN');
      else {
        const acct = bankCells[2]!.replace(/[\s-]/g, '').toUpperCase();
        if (!/^[A-Z0-9]{6,34}$/.test(acct)) problems.push(`Account number / IBAN "${bankCells[2]}" doesn't look right`);
        else data.bank = { bankName: bankCells[0]!, accountTitle: bankCells[1]!, accountNumber: acct, branchCode: v('bankBranchCode') };
      }
    }
    if (!v('phone')) warnings.push('No phone number');

    return { line: i + 2, employeeNumber: number, name: `${firstName} ${lastName}`.trim(), problems, warnings, data: problems.length ? undefined : data };
  });

  // Managers inside the file must not go round in a circle (A → B → A).
  const managerOf = new Map(out.filter((r) => r.data?.managerNumber).map((r) => [lower(r.employeeNumber), lower(r.data!.managerNumber)]));
  for (const r of out) {
    if (!r.data?.managerNumber) continue;
    const seen = new Set([lower(r.employeeNumber)]);
    let m: string | undefined = lower(r.data.managerNumber);
    while (m && managerOf.has(m)) {
      if (seen.has(m)) {
        r.problems.push('Managers go round in a circle (someone ends up managing themselves)');
        r.data = undefined;
        break;
      }
      seen.add(m);
      m = managerOf.get(m);
    }
  }
  return out;
}
