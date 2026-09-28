import { Deduction, Person, appliesTo, contributionLines, currencyMismatch, slabTax, slabsProblem } from './company-deductions';

const base: Deduction = {
  id: 'd1',
  name: 'Pension',
  countryCode: 'AE',
  regionCode: null,
  method: 'PERCENT_OF_BASIC',
  employeePercent: 11,
  employerPercent: 12.5,
  employeeAmount: null,
  employerAmount: null,
  wageCap: null,
  slabs: null,
  currency: null,
  appliesToAll: true,
  employeeIds: [],
  reducesTaxablePay: false,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
};
const dubai: Person = { employeeId: 'e1', countryCode: 'AE', regionCode: 'DU', currency: 'AED' };
const oct = new Date('2026-10-01');

describe('company deductions', () => {
  it('applies by country, province / state, people and months', () => {
    expect(appliesTo(base, dubai, oct)).toBe(true);
    expect(appliesTo({ ...base, countryCode: null }, dubai, oct)).toBe(true); // every country
    expect(appliesTo(base, { ...dubai, countryCode: 'PK' }, oct)).toBe(false);
    expect(appliesTo({ ...base, regionCode: 'SH' }, dubai, oct)).toBe(false);
    expect(appliesTo({ ...base, appliesToAll: false, employeeIds: ['e2'] }, dubai, oct)).toBe(false);
    expect(appliesTo({ ...base, appliesToAll: false, employeeIds: ['e1'] }, dubai, oct)).toBe(true);
    expect(appliesTo({ ...base, effectiveFrom: new Date('2026-11-01') }, dubai, oct)).toBe(false);
    // The last month is included, the one after isn't.
    expect(appliesTo({ ...base, effectiveTo: new Date('2026-10-01') }, dubai, oct)).toBe(true);
    expect(appliesTo({ ...base, effectiveTo: new Date('2026-09-01') }, dubai, oct)).toBe(false);
  });

  it('works out percent of basic, with employee and company parts', () => {
    expect(contributionLines(base, { basic: 20000, gross: 30000 })).toEqual([
      { label: 'Pension', type: 'deduction', amount: 2200, sourceRef: 'd1' },
      { label: 'Pension (Employer)', type: 'employer_contribution', amount: 2500, sourceRef: 'd1' },
    ]);
  });

  it('caps percent of gross at the salary limit', () => {
    const d = { ...base, method: 'PERCENT_OF_GROSS' as const, employeePercent: 10, employerPercent: 0, wageCap: 25000 };
    expect(contributionLines(d, { basic: 20000, gross: 30000 })).toEqual([{ label: 'Pension', type: 'deduction', amount: 2500, sourceRef: 'd1' }]);
  });

  it('uses fixed amounts as they are, and leaves out zero parts', () => {
    const d = { ...base, method: 'FIXED_AMOUNT' as const, employeeAmount: 150, employerAmount: 0, currency: 'AED' };
    expect(contributionLines(d, { basic: 1, gross: 1 })).toEqual([{ label: 'Pension', type: 'deduction', amount: 150, sourceRef: 'd1' }]);
  });

  it('works out yearly tax bands per month', () => {
    const uk = [
      { upTo: 12570, ratePercent: 0 },
      { upTo: 50270, ratePercent: 20 },
      { upTo: 125140, ratePercent: 40 },
      { upTo: null, ratePercent: 45 },
    ];
    expect(slabTax(uk, 1000)).toBe(0); // 12,000 a year
    expect(slabTax(uk, 3000)).toBe(390.5); // (36,000 - 12,570) × 20% / 12
    expect(slabTax(uk, 5000)).toBe(952.67); // 60,000 a year: 7,540 + 9,730 × 40% = 11,432 / 12
    expect(slabTax(uk, 0)).toBe(0);
  });

  it('checks tax bands', () => {
    expect(slabsProblem([])).toMatch(/at least one/);
    expect(slabsProblem([{ upTo: 100, ratePercent: 0 }])).toMatch(/last band/);
    expect(slabsProblem([{ upTo: 100, ratePercent: 0 }, { upTo: 50, ratePercent: 10 }, { upTo: null, ratePercent: 20 }])).toMatch(/higher/);
    expect(slabsProblem([{ upTo: null, ratePercent: 5 }, { upTo: null, ratePercent: 10 }])).toMatch(/Only the last/);
    expect(slabsProblem([{ upTo: 100, ratePercent: 0 }, { upTo: null, ratePercent: 10 }])).toBeNull();
  });

  it('skips amounts in another currency, but not plain percentages', () => {
    expect(currencyMismatch({ ...base, method: 'FIXED_AMOUNT', currency: 'PKR' }, dubai)).toBe(true);
    expect(currencyMismatch({ ...base, wageCap: 1000, currency: 'PKR' }, dubai)).toBe(true);
    expect(currencyMismatch({ ...base, currency: 'PKR' }, dubai)).toBe(false);
    expect(currencyMismatch({ ...base, method: 'FIXED_AMOUNT', currency: 'AED' }, dubai)).toBe(false);
  });
});
