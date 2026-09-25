// Calendar-day helpers. A "day" is stored as midnight UTC of the calendar
// date (see AttendanceRecord.date / Holiday.date). Which calendar date "now"
// falls on depends on the employee's timezone — checking in at 02:00 in
// Karachi is still 21:00 the previous day in UTC — so callers pass the
// branch/org timezone to todayInTimeZone() rather than using UTC.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDayUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Midnight UTC of the calendar date it currently is in `timeZone` (IANA).
// Falls back to UTC for a missing or invalid zone rather than throwing, so a
// typo in a branch's timezone never blocks check-in.
export function todayInTimeZone(timeZone?: string | null, now = new Date()): Date {
  if (!timeZone) return startOfDayUtc(now);
  try {
    // en-CA formats as YYYY-MM-DD
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return new Date(`${ymd}T00:00:00.000Z`);
  } catch {
    return startOfDayUtc(now);
  }
}

// Every calendar day from start to end inclusive, as midnight-UTC dates.
export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (
    let t = startOfDayUtc(start).getTime();
    t <= startOfDayUtc(end).getTime();
    t += MS_PER_DAY
  ) {
    days.push(new Date(t));
  }
  return days;
}

export function dayKey(d: Date): string {
  return startOfDayUtc(d).toISOString().slice(0, 10);
}

// Working days in [start, end]: skips weekend days (JS getUTCDay numbers)
// and any date whose dayKey is in `holidayKeys`.
export function workingDays(
  start: Date,
  end: Date,
  weekendDays: number[],
  holidayKeys: Set<string>,
): Date[] {
  return eachDay(start, end).filter(
    (d) => !weekendDays.includes(d.getUTCDay()) && !holidayKeys.has(dayKey(d)),
  );
}

// Minutes `timeZone` is ahead of UTC at instant `at` (e.g. +300 for Karachi).
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

// The instant it is "HH:mm" on calendar day `day` (midnight UTC) in
// `timeZone`. Falls back to UTC for a missing or invalid zone.
export function zonedTime(day: Date, hhmm: string, timeZone?: string | null): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
  if (!timeZone) return new Date(wall);
  try {
    // Two passes so a time next to a DST change lands on the right offset.
    let guess = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
    guess = wall - offsetMinutes(timeZone, new Date(guess)) * 60000;
    return new Date(guess);
  } catch {
    return new Date(wall);
  }
}
