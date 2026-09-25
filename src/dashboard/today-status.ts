// Where is each person today? Pure, so the rules can be unit-tested:
//   1. an attendance record wins (Present, Late, Half day, Absent, On leave)
//   2. otherwise approved leave covering today → On leave
//   3. otherwise a weekend or holiday → Off
//   4. otherwise → Not in yet

export type TodayStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'OFF' | 'NOT_IN';

export interface TodayInput {
  record: { status: string; checkIn: Date | null } | null;
  onApprovedLeave: boolean;
  isOffDay: boolean;
}

export function todayStatus(input: TodayInput): TodayStatus {
  if (input.record) return input.record.status as TodayStatus;
  if (input.onApprovedLeave) return 'ON_LEAVE';
  if (input.isOffDay) return 'OFF';
  return 'NOT_IN';
}

export interface TodayCounts {
  total: number;
  present: number; // includes late and half day — they came in
  late: number;
  absent: number;
  onLeave: number;
  notIn: number;
  off: number;
  // Came in ÷ expected (everyone not on leave or off), 0–100; null when
  // nobody is expected today (weekend / holiday).
  attendanceRate: number | null;
}

export function countToday(statuses: TodayStatus[]): TodayCounts {
  const c = { present: 0, late: 0, absent: 0, onLeave: 0, notIn: 0, off: 0 };
  for (const s of statuses) {
    if (s === 'PRESENT' || s === 'HALF_DAY') c.present += 1;
    else if (s === 'LATE') {
      c.present += 1;
      c.late += 1;
    } else if (s === 'ABSENT') c.absent += 1;
    else if (s === 'ON_LEAVE') c.onLeave += 1;
    else if (s === 'OFF') c.off += 1;
    else c.notIn += 1;
  }
  const expected = statuses.length - c.onLeave - c.off;
  return {
    total: statuses.length,
    ...c,
    attendanceRate: expected > 0 ? Math.round((c.present / expected) * 100) : null,
  };
}
