import { acceptPoints, liveStatus, routeSummary } from './tracking-rules';

const at = (hhmm: string) => new Date(`2026-12-10T${hhmm}:00Z`);
const now = at('12:00');
// A spot in Karachi; 0.001° of latitude is about 111 m.
const p = (hhmm: string, dLat = 0, accuracy: number | null = 10) => ({ at: at(hhmm), latitude: 24.86 + dLat, longitude: 67.01, accuracy });

describe('which positions are kept', () => {
  const shift = [{ checkIn: at('09:00'), checkOut: null }];

  it('keeps positions only while checked in', () => {
    const { kept, ignored } = acceptPoints([p('08:55'), p('09:05'), p('11:59')], shift, now);
    expect(kept.map((x) => x.at)).toEqual([at('09:05'), at('11:59')]);
    expect(ignored).toBe(1);
  });

  it('drops positions after check-out', () => {
    const done = [{ checkIn: at('09:00'), checkOut: at('11:00') }];
    expect(acceptPoints([p('10:59'), p('11:30')], done, now).kept).toHaveLength(1);
  });

  it('drops the future, the very old, "no fix" and hopeless accuracy, and repeats', () => {
    const wide = [{ checkIn: new Date('2026-12-01T00:00:00Z'), checkOut: null }];
    const pts = [
      p('12:30'), // half an hour ahead
      { ...p('10:00'), at: new Date('2026-12-07T10:00:00Z') }, // 3 days old
      { ...p('10:00'), latitude: 0, longitude: 0 },
      p('10:05', 0, 5000),
      p('10:10'),
      p('10:10'), // sent twice
    ];
    expect(acceptPoints(pts, wide, now).kept.map((x) => x.at)).toEqual([at('10:10')]);
  });

  it('a phone clock a minute ahead is fine', () => {
    expect(acceptPoints([{ ...p('12:00'), at: new Date(now.getTime() + 60_000) }], shift, now).kept).toHaveLength(1);
  });
});

describe('live status', () => {
  const base = { checkedInAt: at('09:00'), lastPointAt: null, lastEvent: null, intervalMinutes: 5, now };

  it('off duty when not checked in', () => {
    expect(liveStatus({ ...base, checkedInAt: null }).status).toBe('NOT_CHECKED_IN');
  });
  it('live while positions keep coming', () => {
    expect(liveStatus({ ...base, lastPointAt: at('11:50') })).toEqual({ status: 'LIVE', since: at('11:50') });
  });
  it('no signal after 15 minutes of silence', () => {
    expect(liveStatus({ ...base, lastPointAt: at('11:40') })).toEqual({ status: 'NO_SIGNAL', since: at('11:40') });
  });
  it('waiting just after check-in, no signal if nothing ever comes', () => {
    expect(liveStatus({ ...base, checkedInAt: at('11:55') }).status).toBe('WAITING');
    expect(liveStatus(base)).toEqual({ status: 'NO_SIGNAL', since: at('09:00') });
  });
  it('location off when the phone says so, until positions come again', () => {
    const off = { at: at('11:00'), kind: 'LOCATION_OFF' };
    expect(liveStatus({ ...base, lastPointAt: at('10:55'), lastEvent: off })).toEqual({ status: 'LOCATION_OFF', since: at('11:00') });
    expect(liveStatus({ ...base, lastPointAt: at('11:58'), lastEvent: off }).status).toBe('LIVE');
  });
  it("yesterday's 'location off' doesn't count today", () => {
    const old = { at: at('08:00'), kind: 'LOCATION_OFF' };
    expect(liveStatus({ ...base, lastPointAt: at('11:58'), lastEvent: old }).status).toBe('LIVE');
  });
  it('a longer interval allows a longer silence', () => {
    expect(liveStatus({ ...base, intervalMinutes: 10, lastPointAt: at('11:35') }).status).toBe('LIVE');
  });
});

describe('route summary', () => {
  it('adds up distance and ignores GPS jumps and unsure positions', () => {
    const route = [p('09:00', 0), p('09:05', 0.01), p('09:06', 1, 10), p('09:10', 0.02), p('09:12', 0.5, 800)];
    // 0 → 0.01 → 0.02 degrees ≈ 2.2 km; the 1° jump (111 km in a minute) and the 800 m-accuracy point are skipped.
    expect(routeSummary(route).distanceKm).toBeCloseTo(2.2, 1);
  });

  it('standing still is not travel', () => {
    expect(routeSummary([p('09:00', 0), p('09:05', 0.0001), p('09:10', 0)]).distanceKm).toBe(0);
  });

  it('finds stops of 10 minutes or more', () => {
    const route = [p('09:00', 0), p('09:20', 0.02), p('09:25', 0.0201), p('09:40', 0.0202), p('09:45', 0.05), p('09:50', 0.0502)];
    const { stops } = routeSummary(route);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ arrivedAt: at('09:20'), leftAt: at('09:40'), minutes: 20 });
    expect(stops[0].latitude).toBeCloseTo(24.8801, 4);
  });
});
