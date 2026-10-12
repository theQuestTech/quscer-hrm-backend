import { distanceMeters } from '../attendance-devices/punch-rules';
import { dayPlan, fillDay, positionAt, simulateNow } from './demo-tracking';
import { routeSummary } from '../tracking/tracking-rules';

// 9:00 am Karachi = 04:00 UTC.
const checkIn = new Date('2026-10-12T04:00:00Z');
const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00Z`);

function fakePrisma() {
  const pings: any[] = [];
  const visits = new Map<string, any>();
  const events = new Map<string, any>();
  const records: any[] = [];
  return {
    pings, visits, events, records,
    locationPing: { createMany: async ({ data }: any) => { pings.push(...data); return { count: data.length }; } },
    fieldVisit: { upsert: async ({ where, create, update }: any) => { visits.set(where.id, { ...(visits.get(where.id) ?? create), ...update }); } },
    trackingEvent: { upsert: async ({ where, create }: any) => { if (!events.has(where.id)) events.set(where.id, create); } },
    employee: { findMany: async () => [{ id: 'e7', employeeNumber: 'ANT-007' }, { id: 'e8', employeeNumber: 'ANT-008' }] },
    organizationLocaleSettings: { findUnique: async () => ({ trackingIntervalMinutes: 5 }) },
    attendanceRecord: {
      findUnique: async ({ where }: any) => records.find((r) => r.employeeId === where.employeeId_date.employeeId && r.date.getTime() === where.employeeId_date.date.getTime()) ?? null,
      create: async ({ data }: any) => { const r = { id: `r${records.length}`, checkOut: null, ...data }; records.push(r); return r; },
      update: async ({ where, data }: any) => Object.assign(records.find((r) => r.id === where.id), data),
    },
  } as any;
}

describe('demo field staff routes', () => {
  it('go from the office to each shop and back, staying a while at each', () => {
    const { visits } = dayPlan('ANT-007', 9 * 60);
    expect(visits.slice(0, 4).map((v) => v.place)).toEqual([
      'Madina General Store, Saddar',
      'Bismillah Mart, Tariq Road',
      'Al-Habib Traders, Bahadurabad',
      'City Cash & Carry, Gulshan-e-Iqbal',
    ]);
    expect(visits.length).toBeGreaterThan(4); // round again in the afternoon
    for (const v of visits) expect(v.leave - v.arrive).toBeGreaterThanOrEqual(25);
  });

  it('move smoothly — no jumps faster than a car in Karachi', () => {
    const legs = dayPlan('ANT-016', 600).legs;
    for (let m = 1; m < 600; m++) {
      const km = distanceMeters(...([m - 1, m].map((x) => { const p = positionAt('ANT-016', x, legs); return { latitude: p.lat, longitude: p.lng }; }) as [any, any])) / 1000;
      expect(km * 60).toBeLessThan(60); // km/h
    }
  });

  it('a full day looks like a real route: some km, stops at the shops', async () => {
    const prisma = fakePrisma();
    await fillDay(prisma, 'org', { id: 'e7', employeeNumber: 'ANT-007' }, checkIn, at('13:00'));
    const pts = prisma.pings.map((p: any) => ({ at: p.at, latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy }));
    const r = routeSummary(pts);
    expect(r.distanceKm).toBeGreaterThan(10);
    expect(r.stops.length).toBeGreaterThanOrEqual(4);
    expect(prisma.pings.every((p: any) => p.battery >= 3 && p.battery <= 96)).toBe(true);
  });

  it('running again adds nothing new and only fills in when they left', async () => {
    const prisma = fakePrisma();
    const e = { id: 'e7', employeeNumber: 'ANT-007' };
    await fillDay(prisma, 'org', e, checkIn, at('05:00'));
    const open = [...prisma.visits.values()].filter((v) => !v.leftAt);
    expect(open).toHaveLength(1); // at the first shop right now
    await fillDay(prisma, 'org', e, checkIn, at('07:00'));
    expect([...prisma.visits.values()].find((v) => v.id === open[0].id).leftAt).toBeInstanceOf(Date);
    expect(new Set(prisma.visits.keys()).size).toBe(prisma.visits.size);
  });

  it("Zainab's location goes off after lunch, Hamza's phone dies at 4:30", async () => {
    const prisma = fakePrisma();
    await fillDay(prisma, 'org', { id: 'e9', employeeNumber: 'ANT-009' }, checkIn, at('12:00'));
    const local = (d: Date) => (d.getUTCHours() + 5) * 60 + d.getUTCMinutes();
    expect(prisma.pings.some((p: any) => local(p.at) >= 14 * 60 && local(p.at) < 14 * 60 + 25)).toBe(false);
    expect([...prisma.events.values()].map((e) => e.kind)).toEqual(['LOCATION_OFF', 'LOCATION_ON']);

    const h = fakePrisma();
    await fillDay(h, 'org', { id: 'e8', employeeNumber: 'ANT-008' }, checkIn, at('15:00'));
    expect(Math.max(...h.pings.map((p: any) => local(p.at)))).toBeLessThan(16 * 60 + 30);
  });

  it('the simulator checks them in during the day and out at 10 pm, never before 9', async () => {
    const prisma = fakePrisma();
    await simulateNow(prisma, 'org', at('03:30')); // 8:30 am
    expect(prisma.records).toHaveLength(0);
    await simulateNow(prisma, 'org', at('06:00')); // 11 am
    expect(prisma.records.map((r: any) => r.checkIn.toISOString())).toEqual(['2026-10-12T04:00:00.000Z', '2026-10-12T04:04:00.000Z']);
    expect(prisma.pings.length).toBeGreaterThan(40);
    await simulateNow(prisma, 'org', at('17:10')); // 10:10 pm
    expect(prisma.records.every((r: any) => r.checkOut?.toISOString() === '2026-10-12T17:00:00.000Z')).toBe(true);
  });
});
