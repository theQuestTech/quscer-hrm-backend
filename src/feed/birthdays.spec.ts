import { birthdayKey, birthdayMessage, hasBirthdayOn } from './birthdays';

describe('hasBirthdayOn', () => {
  it('matches day and month, ignoring the year', () => {
    expect(hasBirthdayOn(new Date('1990-09-26'), new Date('2026-09-26'))).toBe(true);
    expect(hasBirthdayOn(new Date('1990-09-26'), new Date('2026-09-25'))).toBe(false);
    expect(hasBirthdayOn(new Date('1990-10-26'), new Date('2026-09-26'))).toBe(false);
  });

  it('celebrates 29 February on 28 February in non-leap years', () => {
    const leapling = new Date('2000-02-29');
    expect(hasBirthdayOn(leapling, new Date('2027-02-28'))).toBe(true);
    expect(hasBirthdayOn(leapling, new Date('2027-03-01'))).toBe(false);
    expect(hasBirthdayOn(leapling, new Date('2028-02-29'))).toBe(true);
    expect(hasBirthdayOn(leapling, new Date('2028-02-28'))).toBe(false);
  });
});

describe('birthday posts', () => {
  it('uses one key per person per year', () => {
    expect(birthdayKey('emp1', new Date('2026-09-26'))).toBe('birthday:emp1:2026');
  });

  it('never mentions the age', () => {
    expect(birthdayMessage('Sara', 'Acme')).toBe('Happy birthday, Sara! 🎂 Wishing you a wonderful year ahead from everyone at Acme.');
  });
});
