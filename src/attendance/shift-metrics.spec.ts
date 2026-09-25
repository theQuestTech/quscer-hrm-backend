import { computeShiftMetrics } from './shift-metrics';
import { zonedTime } from '../common/dates';

// Karachi is UTC+5 all year, so a 09:00–17:00 shift is 04:00–12:00 UTC.
const day = new Date('2026-10-01');
const base = {
  day,
  shift: { startTime: '09:00', endTime: '17:00' },
  timeZone: 'Asia/Karachi',
  checkIn: null as Date | null,
  checkOut: null as Date | null,
  graceMinutes: 15,
};

describe('zonedTime', () => {
  it('converts a local wall time to UTC', () => {
    expect(zonedTime(day, '09:00', 'Asia/Karachi').toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });

  it('follows daylight saving', () => {
    expect(zonedTime(new Date('2026-03-09'), '09:00', 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(zonedTime(new Date('2026-11-02'), '09:00', 'America/New_York').toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(zonedTime(day, '09:00', 'Not/AZone').toISOString()).toBe('2026-10-01T09:00:00.000Z');
  });
});

describe('computeShiftMetrics', () => {
  it('is not late within the grace period', () => {
    const m = computeShiftMetrics({ ...base, checkIn: new Date('2026-10-01T04:10:00Z') });
    expect(m).toMatchObject({ isLate: false, lateMinutes: 0 });
  });

  it('records the full minutes once past the grace period', () => {
    const m = computeShiftMetrics({ ...base, checkIn: new Date('2026-10-01T04:20:00Z') });
    expect(m).toMatchObject({ isLate: true, lateMinutes: 20 });
  });

  it('counts early exit, overtime and worked time', () => {
    const early = computeShiftMetrics({
      ...base,
      checkIn: new Date('2026-10-01T04:00:00Z'),
      checkOut: new Date('2026-10-01T11:30:00Z'),
    });
    expect(early).toMatchObject({ earlyExitMinutes: 30, overtimeMinutes: 0, workedMinutes: 450 });

    const late = computeShiftMetrics({
      ...base,
      checkIn: new Date('2026-10-01T03:30:00Z'), // arriving early is not overtime
      checkOut: new Date('2026-10-01T13:00:00Z'),
    });
    expect(late).toMatchObject({ earlyExitMinutes: 0, overtimeMinutes: 60, workedMinutes: 570 });
  });

  it('handles a night shift that ends the next day', () => {
    const m = computeShiftMetrics({
      ...base,
      shift: { startTime: '22:00', endTime: '06:00' },
      checkIn: new Date('2026-10-01T17:05:00Z'), // 22:05 local
      checkOut: new Date('2026-10-02T02:00:00Z'), // 07:00 local next day
    });
    expect(m).toMatchObject({ isLate: false, overtimeMinutes: 60, earlyExitMinutes: 0, workedMinutes: 535 });
  });

  it('only measures worked time without a shift', () => {
    const m = computeShiftMetrics({
      ...base,
      shift: null,
      checkIn: new Date('2026-10-01T04:00:00Z'),
      checkOut: new Date('2026-10-01T06:00:00Z'),
    });
    expect(m).toEqual({ lateMinutes: 0, earlyExitMinutes: 0, overtimeMinutes: 0, workedMinutes: 120, isLate: false });
  });
});
