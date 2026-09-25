import { LeaveAccrual } from '@prisma/client';

// WBS 3.9 — how many days of a leave type an employee is entitled to in a
// calendar year, before any carry-forward or manual override.
//
// ANNUAL:  the full yearly quota up front. In the joining year it is
//          prorated by the months left, counting the joining month only if
//          they joined on or before the 15th.
// MONTHLY: quota ÷ 12 is earned at the start of each month worked, up to
//          `asOf` (so in the current year you only have what has accrued).
//
// Results are rounded down to the nearest half day.

export interface EntitlementInput {
  accrual: LeaveAccrual;
  yearlyDays: number;
  dateOfJoining: Date;
  year: number;
  asOf: Date;
}

function floorHalf(n: number) {
  return Math.floor(n * 2 + 1e-9) / 2;
}

// Months of `year` the employee is employed from, 0–12, using the
// "joined by the 15th counts the month" rule.
function monthsFrom(dateOfJoining: Date, year: number): { first: number; count: number } {
  const joinYear = dateOfJoining.getUTCFullYear();
  if (joinYear > year) return { first: 12, count: 0 };
  if (joinYear < year) return { first: 0, count: 12 };
  const month = dateOfJoining.getUTCMonth();
  const first = dateOfJoining.getUTCDate() <= 15 ? month : month + 1;
  return { first, count: 12 - first };
}

export function entitlementForYear(input: EntitlementInput): number {
  const { first, count } = monthsFrom(input.dateOfJoining, input.year);
  if (count === 0 || input.yearlyDays <= 0) return 0;

  if (input.accrual === LeaveAccrual.MONTHLY) {
    const asOfYear = input.asOf.getUTCFullYear();
    if (asOfYear < input.year) return 0;
    // Months that have started by asOf (the current month counts).
    const lastMonth = asOfYear > input.year ? 11 : input.asOf.getUTCMonth();
    const earnedMonths = Math.max(0, lastMonth - first + 1);
    return floorHalf((input.yearlyDays / 12) * earnedMonths);
  }

  return floorHalf((input.yearlyDays * count) / 12);
}

// Allocation for `year` = entitlement + days carried from the previous year
// (capped at maxCarryForward), unless HR set a manual figure for that year.
// Walks back year by year to the joining year.
export interface AllocationInput {
  accrual: LeaveAccrual;
  yearlyDays: number;
  maxCarryForwardDays: number;
  dateOfJoining: Date;
  asOf: Date;
  // Stored balance rows for this employee + leave type, keyed by year.
  rows: Map<number, { usedDays: number; allocatedDays: number; isManualAllocation: boolean }>;
}

export function allocationForYear(input: AllocationInput, year: number): number {
  const row = input.rows.get(year);
  if (row?.isManualAllocation) return row.allocatedDays;

  const entitlement = entitlementForYear({
    accrual: input.accrual,
    yearlyDays: input.yearlyDays,
    dateOfJoining: input.dateOfJoining,
    year,
    asOf: input.asOf,
  });

  let carried = 0;
  if (input.maxCarryForwardDays > 0 && year - 1 >= input.dateOfJoining.getUTCFullYear()) {
    // The previous year is complete, so it counts its full accrual.
    const previousAllocated = allocationForYear(
      { ...input, asOf: new Date(Date.UTC(year - 1, 11, 31)) },
      year - 1,
    );
    const previousUsed = input.rows.get(year - 1)?.usedDays ?? 0;
    carried = Math.min(input.maxCarryForwardDays, Math.max(0, previousAllocated - previousUsed));
  }
  return entitlement + carried;
}
