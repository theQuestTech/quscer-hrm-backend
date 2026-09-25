// WBS 4.6 — how many unpaid days fall inside a payroll period. Pure (no
// database) so the rules can be unit-tested directly:
//   - calendar days before the joining date count as unpaid (1 each)
//   - approved leave of an unpaid leave type counts on working days only
//     (weekends and holidays inside the leave are not deducted)
//   - ABSENT attendance counts 1, HALF_DAY counts 0.5
//   - a date is counted once, even if it is both unpaid leave and absent

import { dayKey, eachDay, startOfDayUtc, workingDays } from '../common/dates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UnpaidDaysInput {
  periodStart: Date;
  periodEnd: Date;
  dateOfJoining: Date;
  unpaidLeave: { startDate: Date; endDate: Date }[];
  absences: { date: Date; status: 'ABSENT' | 'HALF_DAY' | string }[];
  weekendDays: number[];
  holidayKeys: Set<string>;
}

// Unpaid weight (1 or 0.5) per day, keyed by dayKey. Final settlement uses
// the per-day view because its daily rate changes from month to month.
export function unpaidDayWeights(input: UnpaidDaysInput): Map<string, number> {
  const periodStart = startOfDayUtc(input.periodStart);
  const periodEnd = startOfDayUtc(input.periodEnd);
  const weights = new Map<string, number>();

  const joined = startOfDayUtc(input.dateOfJoining);
  if (joined > periodStart) {
    const lastDayBeforeJoining = new Date(joined.getTime() - MS_PER_DAY);
    const until = lastDayBeforeJoining < periodEnd ? lastDayBeforeJoining : periodEnd;
    for (const d of eachDay(periodStart, until)) weights.set(dayKey(d), 1);
  }

  for (const leave of input.unpaidLeave) {
    const from = leave.startDate > periodStart ? leave.startDate : periodStart;
    const to = leave.endDate < periodEnd ? leave.endDate : periodEnd;
    for (const d of workingDays(from, to, input.weekendDays, input.holidayKeys)) {
      weights.set(dayKey(d), 1);
    }
  }

  for (const record of input.absences) {
    const d = startOfDayUtc(record.date);
    if (d < periodStart || d > periodEnd) continue;
    const key = dayKey(d);
    if (!weights.has(key)) weights.set(key, record.status === 'HALF_DAY' ? 0.5 : 1);
  }

  return weights;
}

export function computeUnpaidDays(input: UnpaidDaysInput): number {
  return [...unpaidDayWeights(input).values()].reduce((a, b) => a + b, 0);
}
