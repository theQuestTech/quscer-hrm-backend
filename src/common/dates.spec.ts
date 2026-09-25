import { dayKey, eachDay, todayInTimeZone, workingDays } from './dates';

describe('todayInTimeZone', () => {
  it('uses the local calendar date, not UTC', () => {
    // 20:30 UTC on 1 Oct is already 01:30 on 2 Oct in Karachi (UTC+5)
    const now = new Date('2026-10-01T20:30:00Z');
    expect(dayKey(todayInTimeZone('Asia/Karachi', now))).toBe('2026-10-02');
    expect(dayKey(todayInTimeZone('UTC', now))).toBe('2026-10-01');
  });

  it('falls back to UTC for a missing or invalid timezone', () => {
    const now = new Date('2026-10-01T20:30:00Z');
    expect(dayKey(todayInTimeZone(undefined, now))).toBe('2026-10-01');
    expect(dayKey(todayInTimeZone('Mars/Base', now))).toBe('2026-10-01');
  });
});

describe('workingDays', () => {
  // 1 Oct 2026 is a Thursday
  const start = new Date('2026-10-01');
  const end = new Date('2026-10-07');

  it('counts every day when there are no weekends or holidays', () => {
    expect(eachDay(start, end)).toHaveLength(7);
    expect(workingDays(start, end, [], new Set())).toHaveLength(7);
  });

  it('skips weekend days and holidays', () => {
    const days = workingDays(start, end, [0, 6], new Set(['2026-10-01']));
    // Thu 1 (holiday), Sat 3, Sun 4 skipped → Fri 2, Mon 5, Tue 6, Wed 7
    expect(days.map(dayKey)).toEqual(['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('supports a Sunday-only weekend', () => {
    expect(workingDays(start, end, [0], new Set())).toHaveLength(6);
  });
});
