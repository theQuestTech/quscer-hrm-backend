// Deductions a company sets up itself (Settings → Payroll deductions). Pure
// functions so the money rules can be tested without a database; the payroll
// run calls them for each person after the built-in statutory rules.

export type DeductionMethod = 'PERCENT_OF_BASIC' | 'PERCENT_OF_GROSS' | 'FIXED_AMOUNT' | 'TAX_SLABS';

export interface Slab {
  upTo: number | null; // yearly; null = everything above the previous band
  ratePercent: number;
}

// Numbers here are plain numbers (Prisma Decimals are converted by the caller).
export interface Deduction {
  id: string;
  name: string;
  countryCode: string | null;
  regionCode: string | null;
  method: DeductionMethod;
  employeePercent: number | null;
  employerPercent: number | null;
  employeeAmount: number | null;
  employerAmount: number | null;
  wageCap: number | null;
  slabs: Slab[] | null;
  currency: string | null;
  appliesToAll: boolean;
  employeeIds: string[];
  reducesTaxablePay: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface Person {
  employeeId: string;
  countryCode: string;
  regionCode: string | null;
  currency: string; // of their salary
}

export interface Line {
  label: string;
  type: 'deduction' | 'employer_contribution';
  amount: number;
  sourceRef: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Does this deduction apply to this person in the pay period starting on periodStart?
export function appliesTo(d: Deduction, p: Person, periodStart: Date): boolean {
  if (d.effectiveFrom > periodStart) return false;
  if (d.effectiveTo && periodStart >= nextMonth(d.effectiveTo)) return false;
  if (d.countryCode && d.countryCode !== p.countryCode) return false;
  if (d.regionCode && d.regionCode !== p.regionCode) return false;
  if (!d.appliesToAll && !d.employeeIds.includes(p.employeeId)) return false;
  return true;
}

// Amounts, caps and tax bands are in the deduction's currency, so they can
// only be used for people paid in it. Plain percentages work in any currency.
export function currencyMismatch(d: Deduction, p: Person): boolean {
  const usesMoney = d.method === 'FIXED_AMOUNT' || d.method === 'TAX_SLABS' || d.wageCap !== null;
  return usesMoney && !!d.currency && d.currency !== p.currency;
}

// The employee and company parts of a percent or fixed-amount deduction.
// basic and gross are for the period after unpaid days.
export function contributionLines(d: Deduction, pay: { basic: number; gross: number }): Line[] {
  let employee = 0;
  let employer = 0;
  if (d.method === 'FIXED_AMOUNT') {
    employee = d.employeeAmount ?? 0;
    employer = d.employerAmount ?? 0;
  } else if (d.method === 'PERCENT_OF_BASIC' || d.method === 'PERCENT_OF_GROSS') {
    let base = d.method === 'PERCENT_OF_BASIC' ? pay.basic : pay.gross;
    if (d.wageCap !== null) base = Math.min(base, d.wageCap);
    base = Math.max(0, base);
    employee = (base * (d.employeePercent ?? 0)) / 100;
    employer = (base * (d.employerPercent ?? 0)) / 100;
  }
  const lines: Line[] = [];
  if (round2(employee) > 0) lines.push({ label: d.name, type: 'deduction', amount: round2(employee), sourceRef: d.id });
  if (round2(employer) > 0) lines.push({ label: `${d.name} (Employer)`, type: 'employer_contribution', amount: round2(employer), sourceRef: d.id });
  return lines;
}

// Tax on yearly taxable pay by bands, returned per month.
export function slabTax(slabs: Slab[], monthlyTaxable: number): number {
  const yearly = Math.max(0, monthlyTaxable) * 12;
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (yearly > lower) tax += ((Math.min(yearly, upper) - lower) * s.ratePercent) / 100;
    if (yearly <= upper) break;
    lower = upper;
  }
  return round2(tax / 12);
}

// Bands must go up, and the last one must cover everything above.
export function slabsProblem(slabs: Slab[]): string | null {
  if (!slabs.length) return 'Add at least one band';
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i];
    const last = i === slabs.length - 1;
    if (last && s.upTo !== null) return 'The last band must cover everything above (leave its "up to" empty)';
    if (!last && s.upTo === null) return 'Only the last band can be open-ended';
    if (!last && (s.upTo! <= 0 || (i > 0 && s.upTo! <= slabs[i - 1].upTo!))) return 'Each band must go higher than the one before';
  }
  return null;
}

function nextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
