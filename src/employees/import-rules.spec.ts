import { checkRows, columnFor, normaliseCnic, parseDate } from './import-rules';

const lookups = {
  branches: [{ id: 'b-khi', name: 'Karachi Head Office' }, { id: 'b-lhe', name: 'Lahore' }],
  departments: [{ id: 'd-sales-khi', name: 'Sales', branchId: 'b-khi' }, { id: 'd-sales-lhe', name: 'Sales', branchId: 'b-lhe' }, { id: 'd-acc', name: 'Accounts', branchId: null }],
  shifts: [{ id: 's-day', name: 'Day 9-6' }],
  existing: [{ id: 'e-1', employeeNumber: 'EMP-001', email: 'boss@test.example', cnic: '35202-1111111-1', machineUserId: '7' }],
};
const today = new Date('2026-10-12T00:00:00Z');
const base = { employeeNumber: 'EMP-100', firstName: 'Ali', lastName: 'Raza', email: 'ali@test.example', designation: 'Sales Officer', dateOfJoining: '01/03/2024', phone: '0300-0000000' };
const one = (over: Record<string, string>) => checkRows([{ ...base, ...over }], lookups, today)[0];

describe('reading cells', () => {
  it('reads Pakistani and ISO dates, day first', () => {
    expect(parseDate('01/03/2024')).toBe('2024-03-01');
    expect(parseDate('1-3-24')).toBe('2024-03-01');
    expect(parseDate('2024-03-01')).toBe('2024-03-01');
    expect(parseDate('2024-03-01T00:00:00.000Z')).toBe('2024-03-01');
    expect(parseDate('1 Mar 2024')).toBe('2024-03-01');
    expect(parseDate('01-Mar-24')).toBe('2024-03-01');
    expect(parseDate('31/02/2024')).toBeUndefined();
    expect(parseDate('soon')).toBeUndefined();
  });

  it('formats CNICs with or without dashes', () => {
    expect(normaliseCnic('3520212345671')).toBe('35202-1234567-1');
    expect(normaliseCnic('35202-1234567-1')).toBe('35202-1234567-1');
    expect(normaliseCnic('3520-1234')).toBeUndefined();
  });

  it('matches headers loosely, with common names', () => {
    expect(columnFor('Employee Number')).toBe('employeeNumber');
    expect(columnFor('Emp ID')).toBe('employeeNumber');
    expect(columnFor('DOJ')).toBe('dateOfJoining');
    expect(columnFor('Designation')).toBe('designation');
    expect(columnFor('IBAN')).toBe('accountNumber');
    expect(columnFor('Favourite colour')).toBeUndefined();
  });
});

describe('checking rows', () => {
  it('a good row is ready, with names matched and values cleaned', () => {
    const r = one({ branch: 'karachi head office', department: 'Sales', shift: 'day 9-6', employmentType: 'Permanent', cnic: '3520212345671', gender: 'F', bloodGroup: 'b positive', basicSalary: 'Rs. 85,000', managerNumber: 'emp-001' });
    expect(r.problems).toEqual([]);
    expect(r.data).toMatchObject({
      dateOfJoining: '2024-03-01', branchId: 'b-khi', departmentId: 'd-sales-khi', shiftId: 's-day', employmentType: 'FULL_TIME',
      cnic: '35202-1234567-1', gender: 'FEMALE', bloodGroup: 'B+', basicSalary: 85000, managerNumber: 'emp-001',
    });
  });

  it('reads blood groups written different ways', () => {
    expect(['B positive', 'b+ve', 'O NEG', 'ab-'].map((g) => one({ bloodGroup: g }).data?.bloodGroup)).toEqual(['B+', 'B+', 'O-', 'AB-']);
  });

  it('picks the department in the person\'s own branch', () => {
    expect(one({ branch: 'Lahore', department: 'sales' }).data?.departmentId).toBe('d-sales-lhe');
  });

  it('says exactly what is missing or wrong', () => {
    const r = one({ email: 'not-an-email', dateOfJoining: 'next week', branch: 'Lahre', employmentType: 'freelance', cnic: '123', designation: '' });
    expect(r.data).toBeUndefined();
    expect(r.problems).toEqual([
      'Job title is missing',
      'Work email "not-an-email" doesn\'t look right',
      'Joining date "next week" isn\'t a date we can read — use 2024-03-01 or 01/03/2024',
      'Employment type "freelance" — use Full time, Part time, Contract or Intern',
      'Branch "Lahre" not found — add it in Settings → Branches first, or fix the spelling',
      'CNIC "123" should have 13 digits, like 35202-1234567-1',
    ]);
  });

  it('catches clashes with people already in the company', () => {
    const r = one({ employeeNumber: 'emp-001', email: 'BOSS@test.example', cnic: '35202-1111111-1', machineUserId: '7' });
    expect(r.problems).toEqual([
      'Employee number emp-001 is already used in this company',
      'boss@test.example is already used by another employee',
      'CNIC 35202-1111111-1 already belongs to another employee',
      'Attendance machine ID 7 is already given to someone else',
    ]);
  });

  it('catches repeats inside the file', () => {
    const rows = checkRows([{ ...base }, { ...base, firstName: 'Sara' }], lookups, today);
    expect(rows.every((r) => r.problems.some((p) => p.includes('appears more than once')))).toBe(true);
    expect(rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it('managers can be in the same file, but not missing or in a circle', () => {
    const rows = checkRows(
      [
        { ...base, employeeNumber: 'A', email: 'a@test.example', managerNumber: 'B' },
        { ...base, employeeNumber: 'B', email: 'b@test.example', managerNumber: 'EMP-001' },
        { ...base, employeeNumber: 'C', email: 'c@test.example', managerNumber: 'NOPE' },
        { ...base, employeeNumber: 'D', email: 'd@test.example', managerNumber: 'E' },
        { ...base, employeeNumber: 'E', email: 'e@test.example', managerNumber: 'D' },
        { ...base, employeeNumber: 'F', email: 'f@test.example', managerNumber: 'F' },
      ],
      lookups,
      today,
    );
    expect(rows.map((r) => !!r.data)).toEqual([true, true, false, false, false, false]);
    expect(rows[2].problems).toEqual(["Manager NOPE isn't an employee here or in the file"]);
    expect(rows[3].problems[0]).toMatch(/circle/);
    expect(rows[5].problems).toEqual(["Someone can't be their own manager"]);
  });

  it('bank details need all three parts', () => {
    expect(one({ bankName: 'Test Bank' }).problems).toEqual(['Bank details need all three: bank name, account title and account number / IBAN']);
    const ok = one({ bankName: 'Test Bank', accountTitle: 'Ali Raza', accountNumber: 'PK36 SCBL 0000 0011 2345 6702' });
    expect(ok.data?.bank).toEqual({ bankName: 'Test Bank', accountTitle: 'Ali Raza', accountNumber: 'PK36SCBL0000001123456702', branchCode: undefined });
  });

  it('warns without stopping: future joining date, no phone', () => {
    const r = one({ dateOfJoining: '2026-11-01', phone: '' });
    expect(r.data).toBeDefined();
    expect(r.warnings).toEqual(['Joining date is in the future', 'No phone number']);
  });
});
