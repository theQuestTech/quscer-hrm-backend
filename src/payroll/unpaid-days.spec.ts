import { computeUnpaidDays, UnpaidDaysInput } from './unpaid-days';

// October 2026: 1 Oct is a Thursday; 31 calendar days.
const base: UnpaidDaysInput = {
  periodStart: new Date('2026-10-01'),
  periodEnd: new Date('2026-10-31'),
  dateOfJoining: new Date('2025-01-01'),
  unpaidLeave: [],
  absences: [],
  weekendDays: [0, 6],
  holidayKeys: new Set(),
};

describe('computeUnpaidDays', () => {
  it('is zero for a full month with nothing unpaid', () => {
    expect(computeUnpaidDays(base)).toBe(0);
  });

  it('counts calendar days before a mid-month joining date', () => {
    expect(computeUnpaidDays({ ...base, dateOfJoining: new Date('2026-10-15') })).toBe(14);
  });

  it('counts only working days of unpaid leave', () => {
    const days = computeUnpaidDays({
      ...base,
      // Thu 1 – Wed 7: Sat 3 and Sun 4 are weekend, Thu 1 is a holiday
      unpaidLeave: [{ startDate: new Date('2026-10-01'), endDate: new Date('2026-10-07') }],
      holidayKeys: new Set(['2026-10-01']),
    });
    expect(days).toBe(4);
  });

  it('only counts the part of a leave that falls inside the period', () => {
    const days = computeUnpaidDays({
      ...base,
      // 28 Sep – 2 Oct: only Thu 1 and Fri 2 are in October
      unpaidLeave: [{ startDate: new Date('2026-09-28'), endDate: new Date('2026-10-02') }],
    });
    expect(days).toBe(2);
  });

  it('counts ABSENT as 1 and HALF_DAY as 0.5', () => {
    const days = computeUnpaidDays({
      ...base,
      absences: [
        { date: new Date('2026-10-12'), status: 'ABSENT' },
        { date: new Date('2026-10-13'), status: 'HALF_DAY' },
      ],
    });
    expect(days).toBe(1.5);
  });

  it('never counts the same date twice', () => {
    const days = computeUnpaidDays({
      ...base,
      unpaidLeave: [{ startDate: new Date('2026-10-05'), endDate: new Date('2026-10-05') }],
      absences: [{ date: new Date('2026-10-05'), status: 'ABSENT' }],
    });
    expect(days).toBe(1);
  });

  it('ignores absences outside the period', () => {
    const days = computeUnpaidDays({
      ...base,
      absences: [{ date: new Date('2026-09-30'), status: 'ABSENT' }],
    });
    expect(days).toBe(0);
  });
});
