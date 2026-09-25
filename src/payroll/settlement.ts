// WBS 4.14 — final settlement for someone leaving. Pure (no database) so
// the money rules can be unit-tested; SettlementService gathers the inputs.
//
//   Salary     from the day after the last paid payroll period (or the
//              joining date) up to the last working day. Each day is paid at
//              that month's daily rate (gross ÷ days in that month), minus
//              unpaid days (same rules as payroll).
//   Recovery   if a payroll already paid past the last working day, those
//              days are taken back at the same daily rate.
//   Leave      unused days of encashable leave types × basic ÷ 30.
//   Gratuity   optional — one month's basic per completed year of service.
//              Rules differ by law and contract: check with an accountant.
//   Notice     days paid in lieu of notice (earning) or notice not served
//              (deduction), at gross ÷ 30 per day.
//   Loans      whatever is still owed is recovered.
//   Tax        income tax on the salary and notice pay at the employee's
//              normal monthly effective rate. Encashment and gratuity tax is
//              not worked out here.

import { dayKey, eachDay, startOfDayUtc } from '../common/dates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type SettlementLineType = 'earning' | 'deduction' | 'statutory_deduction' | 'loan_deduction';

export interface SettlementLine {
  label: string;
  type: SettlementLineType;
  amount: number;
  sourceRef?: string;
}

export interface SettlementInput {
  dateOfJoining: Date;
  lastWorkingDay: Date;
  // Last day already covered by an approved payroll run, if any.
  paidThrough: Date | null;
  basicMonthly: number;
  grossMonthly: number;
  // Share of gross that is taxable (0–1).
  taxableShare: number;
  // Income tax ÷ taxable pay for a normal month (0 when no tax applies).
  monthlyTaxRate: number;
  unpaidWeights: Map<string, number>;
  encashableLeave: { leaveTypeName: string; days: number }[];
  includeGratuity: boolean;
  noticeDaysInLieu: number;
  noticeDaysShort: number;
  loans: { id: string; remainingBalance: number }[];
  adjustments: { label: string; amount: number; type: 'earning' | 'deduction' }[];
}

export interface SettlementResult {
  lines: SettlementLine[];
  totalEarnings: number;
  totalDeductions: number;
  netAmount: number;
}

function daysInMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function fmt(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function completedYears(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(Date.UTC(to.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (anniversary > to) years -= 1;
  return Math.max(0, years);
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const lines: SettlementLine[] = [];
  const lwd = startOfDayUtc(input.lastWorkingDay);
  const joined = startOfDayUtc(input.dateOfJoining);
  const dailyRate = (d: Date) => input.grossMonthly / daysInMonth(d);

  // Salary for the unpaid stretch up to the last working day.
  const paidThrough = input.paidThrough ? startOfDayUtc(input.paidThrough) : null;
  let from = paidThrough ? new Date(paidThrough.getTime() + MS_PER_DAY) : joined;
  if (from < joined) from = joined;
  let taxableBase = 0;
  if (from <= lwd) {
    const days = eachDay(from, lwd);
    const salary = round2(days.reduce((sum, d) => sum + dailyRate(d), 0));
    lines.push({ label: `Salary ${fmt(from)} – ${fmt(lwd)} (${days.length} days)`, type: 'earning', amount: salary });
    let unpaidDays = 0;
    let unpaidAmount = 0;
    for (const d of days) {
      const weight = input.unpaidWeights.get(dayKey(d)) ?? 0;
      unpaidDays += weight;
      unpaidAmount += weight * dailyRate(d);
    }
    unpaidAmount = round2(unpaidAmount);
    if (unpaidAmount > 0) {
      lines.push({ label: `Unpaid days (${unpaidDays})`, type: 'deduction', amount: unpaidAmount });
    }
    taxableBase += (salary - unpaidAmount) * input.taxableShare;
  }

  // Paid past the last working day already → take it back.
  if (paidThrough && paidThrough > lwd) {
    const days = eachDay(new Date(lwd.getTime() + MS_PER_DAY), paidThrough);
    const recovery = round2(days.reduce((sum, d) => sum + dailyRate(d), 0));
    const start = days[0];
    lines.push({
      label: `Recovery: salary already paid for ${fmt(start)} – ${fmt(paidThrough)} (${days.length} days)`,
      type: 'deduction',
      amount: recovery,
    });
    taxableBase -= recovery * input.taxableShare;
  }

  for (const leave of input.encashableLeave) {
    if (leave.days <= 0) continue;
    lines.push({
      label: `Leave encashment – ${leave.leaveTypeName} (${leave.days} days)`,
      type: 'earning',
      amount: round2((leave.days * input.basicMonthly) / 30),
    });
  }

  if (input.includeGratuity) {
    const years = completedYears(joined, lwd);
    if (years > 0) {
      lines.push({
        label: `Gratuity (${years} year${years === 1 ? '' : 's'} × last basic salary)`,
        type: 'earning',
        amount: round2(years * input.basicMonthly),
      });
    }
  }

  const noticeDailyRate = input.grossMonthly / 30;
  if (input.noticeDaysInLieu > 0) {
    const amount = round2(input.noticeDaysInLieu * noticeDailyRate);
    lines.push({ label: `Notice pay in lieu (${input.noticeDaysInLieu} days)`, type: 'earning', amount });
    taxableBase += amount * input.taxableShare;
  }
  if (input.noticeDaysShort > 0) {
    lines.push({
      label: `Notice period not served (${input.noticeDaysShort} days)`,
      type: 'deduction',
      amount: round2(input.noticeDaysShort * noticeDailyRate),
    });
  }

  for (const a of input.adjustments) {
    if (a.amount > 0) lines.push({ label: a.label, type: a.type, amount: round2(a.amount) });
  }

  const tax = round2(Math.max(0, taxableBase) * input.monthlyTaxRate);
  if (tax > 0) lines.push({ label: 'Income tax', type: 'statutory_deduction', amount: tax });

  for (const loan of input.loans) {
    if (loan.remainingBalance > 0) {
      lines.push({ label: 'Loan balance recovered', type: 'loan_deduction', amount: round2(loan.remainingBalance), sourceRef: loan.id });
    }
  }

  const totalEarnings = round2(lines.filter((l) => l.type === 'earning').reduce((s, l) => s + l.amount, 0));
  const totalDeductions = round2(lines.filter((l) => l.type !== 'earning').reduce((s, l) => s + l.amount, 0));
  return { lines, totalEarnings, totalDeductions, netAmount: round2(totalEarnings - totalDeductions) };
}
