import { completedYears, computeSettlement, SettlementInput } from './settlement';

// September 2026 has 30 days, so a 30,000 gross is 1,000 a day.
const base: SettlementInput = {
  dateOfJoining: new Date('2020-01-01'),
  lastWorkingDay: new Date('2026-09-20'),
  paidThrough: new Date('2026-08-31'),
  basicMonthly: 20000,
  grossMonthly: 30000,
  taxableShare: 1,
  monthlyTaxRate: 0,
  unpaidWeights: new Map(),
  encashableLeave: [],
  includeGratuity: false,
  noticeDaysInLieu: 0,
  noticeDaysShort: 0,
  loans: [],
  adjustments: [],
};

const amount = (r: ReturnType<typeof computeSettlement>, label: string) =>
  r.lines.find((l) => l.label.startsWith(label))?.amount;

describe('computeSettlement', () => {
  it('pays salary from the day after the last paid period to the last working day', () => {
    const r = computeSettlement(base);
    expect(amount(r, 'Salary')).toBe(20000);
    expect(r.netAmount).toBe(20000);
  });

  it('uses each month’s own daily rate across a month end', () => {
    // 29–31 Jul at 30000/31 + 1–2 Aug at 30000/31 = 5 × 967.74…
    const r = computeSettlement({ ...base, paidThrough: new Date('2026-07-28'), lastWorkingDay: new Date('2026-08-02') });
    expect(amount(r, 'Salary')).toBe(4838.71);
  });

  it('deducts unpaid days at that day’s rate', () => {
    const r = computeSettlement({ ...base, unpaidWeights: new Map([['2026-09-10', 1], ['2026-09-11', 0.5]]) });
    expect(amount(r, 'Unpaid days (1.5)')).toBe(1500);
    expect(r.netAmount).toBe(18500);
  });

  it('recovers salary already paid past the last working day', () => {
    const r = computeSettlement({ ...base, paidThrough: new Date('2026-09-30') });
    expect(amount(r, 'Salary')).toBeUndefined();
    expect(amount(r, 'Recovery')).toBe(10000);
    expect(r.netAmount).toBe(-10000);
  });

  it('pays leave encashment at basic ÷ 30 and gratuity per completed year', () => {
    const r = computeSettlement({
      ...base,
      encashableLeave: [{ leaveTypeName: 'Annual', days: 5 }],
      includeGratuity: true,
    });
    expect(amount(r, 'Leave encashment')).toBe(3333.33);
    expect(amount(r, 'Gratuity (6 years')).toBe(120000);
  });

  it('handles notice pay, notice recovery, adjustments, tax and loans', () => {
    const r = computeSettlement({
      ...base,
      monthlyTaxRate: 0.1,
      noticeDaysInLieu: 3,
      noticeDaysShort: 1,
      loans: [{ id: 'loan-1', remainingBalance: 2500 }],
      adjustments: [{ label: 'Laptop not returned', amount: 400, type: 'deduction' }],
    });
    expect(amount(r, 'Notice pay in lieu')).toBe(3000);
    expect(amount(r, 'Notice period not served')).toBe(1000);
    expect(amount(r, 'Income tax')).toBe(2300); // 10% of salary 20000 + notice pay 3000
    expect(r.lines.find((l) => l.type === 'loan_deduction')).toMatchObject({ amount: 2500, sourceRef: 'loan-1' });
    expect(r.totalEarnings).toBe(23000);
    expect(r.totalDeductions).toBe(1000 + 400 + 2300 + 2500);
    expect(r.netAmount).toBe(23000 - 6200);
  });

  it('starts from the joining date when nothing has been paid yet', () => {
    const r = computeSettlement({ ...base, dateOfJoining: new Date('2026-09-11'), paidThrough: null });
    expect(amount(r, 'Salary')).toBe(10000);
  });
});

describe('completedYears', () => {
  it('counts only full years', () => {
    expect(completedYears(new Date('2020-09-21'), new Date('2026-09-20'))).toBe(5);
    expect(completedYears(new Date('2020-09-20'), new Date('2026-09-20'))).toBe(6);
  });
});
