import { certificateExpiry, certificateState, creditedHours, seatsLeft } from './training-rules';

describe('certificateExpiry', () => {
  it('adds months and keeps the day where it exists', () => {
    expect(certificateExpiry(new Date('2026-03-15T00:00:00Z'), 12)?.toISOString().slice(0, 10)).toBe('2027-03-15');
    expect(certificateExpiry(new Date('2026-01-31T00:00:00Z'), 1)?.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(certificateExpiry(new Date('2027-11-30T00:00:00Z'), 3)?.toISOString().slice(0, 10)).toBe('2028-02-29');
  });
  it('no validity = never expires', () => {
    expect(certificateExpiry(new Date(), null)).toBeNull();
    expect(certificateExpiry(new Date(), 0)).toBeNull();
  });
});

describe('certificateState', () => {
  const now = new Date('2026-10-01T15:00:00Z');
  it('valid, expiring within 60 days, or expired', () => {
    expect(certificateState(null, now)).toBe('NONE');
    expect(certificateState(new Date('2027-06-01'), now)).toBe('VALID');
    expect(certificateState(new Date('2026-11-30'), now)).toBe('EXPIRING');
    expect(certificateState(new Date('2026-10-01'), now)).toBe('EXPIRING'); // last valid day
    expect(certificateState(new Date('2026-09-30'), now)).toBe('EXPIRED');
  });
});

describe('creditedHours', () => {
  it('uses the course length, else the session length', () => {
    expect(creditedHours(6)).toBe(6);
    expect(creditedHours(null, new Date('2026-10-01T09:00:00Z'), new Date('2026-10-01T12:20:00Z'))).toBe(3.5);
    expect(creditedHours(null)).toBeNull();
  });
});

describe('seatsLeft', () => {
  it('counts free seats, unlimited when no capacity', () => {
    expect(seatsLeft(10, 7)).toBe(3);
    expect(seatsLeft(5, 9)).toBe(0);
    expect(seatsLeft(null, 50)).toBeNull();
  });
});
