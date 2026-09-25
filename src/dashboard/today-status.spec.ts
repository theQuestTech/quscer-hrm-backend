import { countToday, todayStatus } from './today-status';

describe('todayStatus', () => {
  it('uses the attendance record first', () => {
    expect(todayStatus({ record: { status: 'LATE', checkIn: new Date() }, onApprovedLeave: true, isOffDay: true })).toBe('LATE');
  });
  it('then approved leave, then off days, then not in', () => {
    expect(todayStatus({ record: null, onApprovedLeave: true, isOffDay: true })).toBe('ON_LEAVE');
    expect(todayStatus({ record: null, onApprovedLeave: false, isOffDay: true })).toBe('OFF');
    expect(todayStatus({ record: null, onApprovedLeave: false, isOffDay: false })).toBe('NOT_IN');
  });
});

describe('countToday', () => {
  it('counts late and half day as present and works out the rate', () => {
    const c = countToday(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'NOT_IN']);
    expect(c).toMatchObject({ total: 6, present: 3, late: 1, absent: 1, onLeave: 1, notIn: 1, off: 0 });
    expect(c.attendanceRate).toBe(60); // 3 of the 5 expected (on leave excluded)
  });
  it('has no rate on a day off', () => {
    expect(countToday(['OFF', 'OFF']).attendanceRate).toBeNull();
    expect(countToday([]).attendanceRate).toBeNull();
  });
});
