import {
  dayTimes, distanceMeters, effectiveRules, ipAllowed, nearestOffice, normalizeMachineId, parseAttlog, parseCidr, workDateFor,
} from './punch-rules';
import { wallClockToUtc } from '../common/dates';

describe('office network', () => {
  it('matches single addresses and ranges, IPv4 and IPv6', () => {
    expect(ipAllowed('39.45.10.20', ['39.45.10.20'])).toBe(true);
    expect(ipAllowed('39.45.10.99', ['39.45.10.0/24'])).toBe(true);
    expect(ipAllowed('39.45.11.1', ['39.45.10.0/24'])).toBe(false);
    expect(ipAllowed('::ffff:39.45.10.20', ['39.45.10.20'])).toBe(true);
    expect(ipAllowed('2400:adc0:1::5', ['2400:adc0::/32'])).toBe(true);
    expect(ipAllowed('2401::5', ['2400:adc0::/32'])).toBe(false);
    expect(ipAllowed('not-an-ip', ['0.0.0.0/0'])).toBe(false);
    expect(ipAllowed('1.2.3.4', [])).toBe(false);
  });
  it('rejects bad ranges', () => {
    expect(parseCidr('39.45.10.0/33')).toBeNull();
    expect(parseCidr('39.45.10/24')).toBeNull();
    expect(parseCidr('1.2.3.4/2x')).toBeNull();
    expect(parseCidr('hello')).toBeNull();
    expect(parseCidr('1.2.3.4')).toEqual({ address: '1.2.3.4', prefix: 32, family: 'ipv4' });
  });
});

describe('office location', () => {
  const office = { latitude: 31.5204, longitude: 74.3587, radiusMeters: 200 }; // Lahore
  it('measures distance', () => {
    expect(Math.round(distanceMeters(office, { latitude: 31.5204, longitude: 74.3608 }))).toBeGreaterThan(190);
    expect(Math.round(distanceMeters(office, { latitude: 31.5204, longitude: 74.3608 }))).toBeLessThan(210);
  });
  it('inside the radius, with a capped allowance for GPS accuracy', () => {
    expect(nearestOffice({ latitude: 31.5205, longitude: 74.3588 }, [office])!.inside).toBe(true);
    expect(nearestOffice({ latitude: 31.5204, longitude: 74.3615, accuracy: 80 }, [office])!.inside).toBe(true); // ~265 m, ±80
    expect(nearestOffice({ latitude: 31.5204, longitude: 74.3700, accuracy: 5000 }, [office])!.inside).toBe(false); // ~1 km
    expect(nearestOffice({ latitude: 31.5, longitude: 74.3 }, [])).toBeNull();
  });
});

describe('effectiveRules', () => {
  const company = { defaultCheckInMethod: 'BOTH', defaultRequireOfficeNetwork: false, defaultRequireOfficeLocation: true };
  it('uses the company default unless the employee has their own', () => {
    expect(effectiveRules({ checkInMethod: null, requireOfficeNetwork: null, requireOfficeLocation: null }, company)).toEqual({
      method: 'BOTH', canUseApp: true, needsOfficeNetwork: false, needsOfficeLocation: true,
    });
    const r = effectiveRules({ checkInMethod: 'MACHINE', requireOfficeNetwork: true, requireOfficeLocation: false }, company);
    expect(r.canUseApp).toBe(false);
    expect(r.needsOfficeNetwork).toBe(true);
    expect(r.needsOfficeLocation).toBe(false);
  });
});

describe('machine punches', () => {
  it('reads ZKTeco ATTLOG lines', () => {
    const body = '12\t2026-10-01 09:02:11\t0\t1\t0\t0\n0012\t2026-10-01 18:05:00\t1\t1\n\nbad line\n7\t2026-13-01 09:00:00\t0';
    const p = parseAttlog(body);
    expect(p.map((x) => [x.machineUserId, x.wallTime, x.kind])).toEqual([
      ['12', '2026-10-01 09:02:11', 'IN'],
      ['0012', '2026-10-01 18:05:00', 'OUT'],
      ['7', '2026-13-01 09:00:00', 'IN'],
    ]);
    expect(wallClockToUtc('2026-13-01 09:00:00', 'Asia/Karachi')).toBeNull();
  });
  it('treats 00012 and 12 as the same machine ID', () => {
    expect(normalizeMachineId(' 00012 ')).toBe('12');
    expect(normalizeMachineId('EMP-7')).toBe('EMP-7');
  });
  it('converts machine local time to the real moment', () => {
    expect(wallClockToUtc('2026-10-01 09:02:11', 'Asia/Karachi')!.toISOString()).toBe('2026-10-01T04:02:11.000Z');
  });
  it('overnight shifts: early-morning punches count for the day before', () => {
    const night = { startTime: '22:00', endTime: '06:00' };
    const at = (w: string) => wallClockToUtc(w, 'Asia/Karachi')!;
    expect(workDateFor(at('2026-10-02 06:10:00'), 'Asia/Karachi', night).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(workDateFor(at('2026-10-01 21:55:00'), 'Asia/Karachi', night).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(workDateFor(at('2026-10-02 06:10:00'), 'Asia/Karachi', { startTime: '09:00', endTime: '18:00' }).toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(workDateFor(at('2026-10-02 00:30:00'), 'Asia/Karachi', null).toISOString().slice(0, 10)).toBe('2026-10-02');
  });
  it('first punch in, last punch out', () => {
    const t = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 1, h, m));
    expect(dayTimes([t(13), t(4), t(8)])).toEqual({ checkIn: t(4), checkOut: t(13) });
    expect(dayTimes([t(4)])).toEqual({ checkIn: t(4), checkOut: null });
    expect(dayTimes([t(4), new Date(t(4).getTime() + 20_000)])).toEqual({ checkIn: t(4), checkOut: null }); // double tap
    expect(dayTimes([])).toEqual({ checkIn: null, checkOut: null });
  });
});
