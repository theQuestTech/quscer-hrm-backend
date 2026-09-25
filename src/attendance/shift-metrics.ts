import { zonedTime } from '../common/dates';

// WBS 3.4 — late arrival, early exit, overtime and worked time for one day,
// measured against the employee's shift in their branch timezone. A shift
// whose end is at or before its start (22:00–06:00) ends the next day.
//
// Late only counts once past the grace period, but then the full minutes
// are recorded (grace 15, arrived 20 min late → 20). Overtime is time
// after the shift's end; arriving early is not overtime.

export interface ShiftMetricsInput {
  day: Date; // the attendance date, midnight UTC
  shift: { startTime: string; endTime: string } | null;
  timeZone?: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  graceMinutes: number;
}

export interface ShiftMetrics {
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number | null;
  isLate: boolean;
}

const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60000);

export function shiftWindow(day: Date, shift: { startTime: string; endTime: string }, timeZone?: string | null) {
  const start = zonedTime(day, shift.startTime, timeZone);
  let end = zonedTime(day, shift.endTime, timeZone);
  if (end <= start) {
    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    end = zonedTime(nextDay, shift.endTime, timeZone);
  }
  return { start, end };
}

export function computeShiftMetrics(input: ShiftMetricsInput): ShiftMetrics {
  const { checkIn, checkOut } = input;
  const workedMinutes = checkIn && checkOut ? Math.max(0, minutesBetween(checkIn, checkOut)) : null;
  const result: ShiftMetrics = { lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 0, workedMinutes, isLate: false };
  if (!input.shift) return result;

  const { start, end } = shiftWindow(input.day, input.shift, input.timeZone);
  if (checkIn) {
    const late = minutesBetween(start, checkIn);
    if (late > input.graceMinutes) {
      result.lateMinutes = late;
      result.isLate = true;
    }
  }
  if (checkOut) {
    result.earlyExitMinutes = Math.max(0, minutesBetween(checkOut, end));
    result.overtimeMinutes = Math.max(0, minutesBetween(end, checkOut));
  }
  return result;
}
