import { totalsByCurrency } from './totals';

describe('totalsByCurrency', () => {
  it('keeps each currency separate, the one with most people first', () => {
    const totals = totalsByCurrency([
      { currency: 'AED', netSalary: 17800, grossSalary: 20000, totalDeductions: 2200 },
      { currency: 'SAR', netSalary: 17500, grossSalary: 20000, totalDeductions: 2500 },
      { currency: 'AED', netSalary: 17800.1, grossSalary: 20000, totalDeductions: 2199.9 },
    ]);
    expect(totals).toEqual([
      { currency: 'AED', people: 2, gross: 40000, deductions: 4399.9, net: 35600.1 },
      { currency: 'SAR', people: 1, gross: 20000, deductions: 2500, net: 17500 },
    ]);
  });

  it('is empty for no one', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });

  it('reads Prisma decimals (anything with toString)', () => {
    const dec = (v: string) => ({ toString: () => v });
    expect(totalsByCurrency([{ currency: 'PKR', netSalary: dec('1000.50') }])[0].net).toBe(1000.5);
  });
});
