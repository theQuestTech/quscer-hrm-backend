// Field tracking for the staging demo company: five made-up field staff driving
// between made-up shops in real Karachi areas. Their positions are worked out from
// the time of day, so the demo build (past days) and the staging simulator (today,
// every couple of minutes) produce the same routes.
//
//   Sana, Hamza, Zainab (sales officers, Kamran's team) visit shops.
//   Noman, Waqas (delivery drivers, Imran's team) make deliveries.
//   Zainab switches location off for 25 minutes after lunch; Hamza's phone dies
//   at 4:30 pm — so the live map shows each state.

import { PrismaService } from '../prisma/prisma.service';
import { distanceMeters } from '../attendance-devices/punch-rules';

export const FIELD_STAFF = ['ANT-007', 'ANT-008', 'ANT-009', 'ANT-016', 'ANT-017'];

type Point = { lat: number; lng: number };
type Stop = Point & { place: string; dwell: number };

const OFFICE: Point = { lat: 24.8512, lng: 67.0098 }; // Karachi head office, I.I. Chundrigar Road
const KARACHI_OFFSET = 5 * 60; // minutes, UTC+5

const PLANS: Record<string, { kind: 'Visit' | 'Delivery'; stops: Stop[] }> = {
  'ANT-007': {
    kind: 'Visit',
    stops: [
      { place: 'Madina General Store, Saddar', lat: 24.8556, lng: 67.0302, dwell: 30 },
      { place: 'Bismillah Mart, Tariq Road', lat: 24.8721, lng: 67.0638, dwell: 35 },
      { place: 'Al-Habib Traders, Bahadurabad', lat: 24.8818, lng: 67.0701, dwell: 25 },
      { place: 'City Cash & Carry, Gulshan-e-Iqbal', lat: 24.9204, lng: 67.0932, dwell: 40 },
    ],
  },
  'ANT-008': {
    kind: 'Visit',
    stops: [
      { place: 'Rehman Kiryana, Nazimabad', lat: 24.9102, lng: 67.0331, dwell: 30 },
      { place: 'Star Super Store, North Nazimabad', lat: 24.9421, lng: 67.0452, dwell: 35 },
      { place: 'Usmania Traders, Gulberg', lat: 24.9263, lng: 67.0641, dwell: 25 },
    ],
  },
  'ANT-009': {
    kind: 'Visit',
    stops: [
      { place: 'Clifton Grocers, Clifton Block 5', lat: 24.8131, lng: 67.0298, dwell: 35 },
      { place: 'Sea View Mart, Defence Phase 6', lat: 24.7962, lng: 67.0652, dwell: 30 },
      { place: 'Zamzama Foods, Defence Phase 5', lat: 24.8135, lng: 67.0441, dwell: 25 },
    ],
  },
  'ANT-016': {
    kind: 'Delivery',
    stops: [
      { place: 'Korangi Wholesale Market', lat: 24.8352, lng: 67.1302, dwell: 20 },
      { place: 'Jauhar Super Mart, Gulistan-e-Jauhar', lat: 24.9198, lng: 67.1298, dwell: 20 },
      { place: 'PECHS Store, Shahrah-e-Faisal', lat: 24.8642, lng: 67.0748, dwell: 15 },
    ],
  },
  'ANT-017': {
    kind: 'Delivery',
    stops: [
      { place: 'SITE Area Depot', lat: 24.9002, lng: 66.9903, dwell: 25 },
      { place: 'Lyari Market Shop', lat: 24.8669, lng: 66.9934, dwell: 15 },
      { place: 'Kharadar Traders', lat: 24.8571, lng: 67.0012, dwell: 15 },
    ],
  },
};

const SPEED_KMH = 20; // Karachi traffic
const ZAINAB_OFF = { from: 14 * 60, to: 14 * 60 + 25 }; // local minutes of the day
const HAMZA_DEAD = 16 * 60 + 30;

export interface PlannedVisit {
  index: number; // nth stop of the day
  place: string;
  kind: 'Visit' | 'Delivery';
  lat: number;
  lng: number;
  arrive: number; // minutes after check-in
  leave: number;
}

type Leg = { from: Point; to: Point; start: number; end: number } | { at: Point; start: number; end: number; stop?: PlannedVisit };

// The day as legs: from the office to each stop and back, round and round,
// up to `minutes` after check-in.
export function dayPlan(no: string, minutes: number): { legs: Leg[]; visits: PlannedVisit[] } {
  const plan = PLANS[no];
  const legs: Leg[] = [];
  const visits: PlannedVisit[] = [];
  if (!plan) return { legs, visits };
  let t = 10; // ten minutes at the office first
  legs.push({ at: OFFICE, start: 0, end: t });
  let here: Point = OFFICE;
  let n = 0;
  while (t < minutes) {
    const targets: (Stop | null)[] = [...plan.stops, null]; // null = back to the office
    for (const s of targets) {
      const to = s ?? OFFICE;
      const travel = Math.max(6, (distanceMeters(toLatLng(here), toLatLng(to)) / 1000 / SPEED_KMH) * 60);
      legs.push({ from: here, to, start: t, end: t + travel });
      t += travel;
      const dwell = s ? s.dwell : 45; // back at the office: paperwork, tea, loading up
      const visit = s ? { index: n++, place: s.place, kind: plan.kind, lat: s.lat, lng: s.lng, arrive: t, leave: t + dwell } : undefined;
      if (visit) visits.push(visit);
      legs.push({ at: to, start: t, end: t + dwell, stop: visit });
      t += dwell;
      here = to;
      if (t >= minutes) break;
    }
  }
  return { legs, visits: visits.filter((v) => v.arrive <= minutes) };
}

const toLatLng = (p: Point) => ({ latitude: p.lat, longitude: p.lng });

// Small, repeatable wobble so dots don't sit on a perfect line.
function wobble(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 0.0004;
}

export function positionAt(no: string, minutes: number, legs = dayPlan(no, minutes + 1).legs): Point {
  const leg = legs.find((l) => minutes >= l.start && minutes < l.end) ?? legs[legs.length - 1];
  const seed = minutes * 31 + no.charCodeAt(5) * 7 + no.charCodeAt(6);
  if (!leg) return OFFICE;
  if ('at' in leg) return { lat: leg.at.lat + wobble(seed) / 4, lng: leg.at.lng + wobble(seed + 1) / 4 };
  const f = (minutes - leg.start) / (leg.end - leg.start);
  // Roads aren't straight: bend the line a little.
  const bend = Math.sin(Math.PI * f) * 0.12;
  const dLat = leg.to.lat - leg.from.lat;
  const dLng = leg.to.lng - leg.from.lng;
  return {
    lat: leg.from.lat + dLat * f - dLng * bend + wobble(seed),
    lng: leg.from.lng + dLng * f + dLat * bend + wobble(seed + 1),
  };
}

const localMinutes = (d: Date) => (d.getUTCHours() * 60 + d.getUTCMinutes() + KARACHI_OFFSET) % 1440;

// Fills one person's day: positions every `interval` minutes from check-in until
// `until`, their shop visits / deliveries, and Zainab's location-off break.
// Safe to run again and again: nothing is added twice.
export async function fillDay(
  prisma: PrismaService,
  organizationId: string,
  employee: { id: string; employeeNumber: string },
  checkIn: Date,
  until: Date,
  interval = 5,
) {
  const no = employee.employeeNumber;
  if (!PLANS[no] || until <= checkIn) return { points: 0 };
  const span = (until.getTime() - checkIn.getTime()) / 60000;
  const { legs, visits } = dayPlan(no, span);
  const day = checkIn.toISOString().slice(0, 10);

  const points: { organizationId: string; employeeId: string; at: Date; latitude: number; longitude: number; accuracy: number; battery: number }[] = [];
  for (let m = 0; m <= span; m += interval) {
    const at = new Date(checkIn.getTime() + m * 60000);
    const local = localMinutes(at);
    if (no === 'ANT-009' && local >= ZAINAB_OFF.from && local < ZAINAB_OFF.to) continue;
    if (no === 'ANT-008' && local >= HAMZA_DEAD) break;
    const p = positionAt(no, m, legs);
    const drain = no === 'ANT-008' ? m / 6 : m / 9; // percent used so far
    points.push({
      organizationId,
      employeeId: employee.id,
      at,
      latitude: Math.round(p.lat * 1e6) / 1e6,
      longitude: Math.round(p.lng * 1e6) / 1e6,
      accuracy: 8 + Math.round(Math.abs(wobble(m + 3)) * 40000),
      battery: Math.max(3, Math.round(96 - drain)),
    });
  }
  const saved = points.length ? (await prisma.locationPing.createMany({ data: points, skipDuplicates: true })).count : 0;

  // Visits: the same id every time, so a later run only fills in when they left.
  for (const v of visits) {
    const arrivedAt = new Date(checkIn.getTime() + v.arrive * 60000);
    const leftAt = new Date(checkIn.getTime() + v.leave * 60000);
    if (no === 'ANT-008' && localMinutes(arrivedAt) >= HAMZA_DEAD) break;
    const id = `demo-${employee.id}-${day}-${v.index}`;
    const data = { leftAt: leftAt <= until ? leftAt : null };
    await prisma.fieldVisit.upsert({
      where: { id },
      create: {
        id,
        organizationId,
        employeeId: employee.id,
        arrivedAt,
        latitude: v.lat,
        longitude: v.lng,
        accuracy: 12,
        place: v.kind === 'Delivery' ? `Delivery: ${v.place}` : v.place,
        notes: v.kind === 'Delivery' ? 'Goods delivered, signed for' : ['Took this month’s order', 'Collected payment', 'New price list shared'][v.index % 3],
        ...data,
      },
      update: data,
    });
  }

  // Zainab's lunch break with location off.
  if (no === 'ANT-009') {
    const base = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate()) - KARACHI_OFFSET * 60000;
    const off = new Date(base + ZAINAB_OFF.from * 60000);
    const on = new Date(base + ZAINAB_OFF.to * 60000);
    for (const [kind, at] of [['LOCATION_OFF', off], ['LOCATION_ON', on]] as const) {
      if (at < checkIn || at > until) continue;
      const id = `demo-${employee.id}-${day}-${kind}`;
      await prisma.trackingEvent.upsert({ where: { id }, create: { id, organizationId, employeeId: employee.id, at, kind }, update: {} });
    }
  }
  return { points: saved };
}

// Work hours for the demo field staff, Karachi time: 9 am until 10 pm, so the map
// is alive for demos in the evening too.
export const DEMO_DAY = { start: 9 * 60, end: 22 * 60 };

// Keeps the demo field staff's day going: checks them in, adds positions up to
// now, checks them out late in the evening. Staging only; called every few minutes.
export async function simulateNow(prisma: PrismaService, organizationId: string, now = new Date()) {
  const local = localMinutes(now);
  const karachiNow = new Date(now.getTime() + KARACHI_OFFSET * 60000);
  const today = new Date(Date.UTC(karachiNow.getUTCFullYear(), karachiNow.getUTCMonth(), karachiNow.getUTCDate())); // the Karachi calendar day
  const dayStart = new Date(today.getTime() - KARACHI_OFFSET * 60000); // local midnight
  const staff = await prisma.employee.findMany({ where: { organizationId, employeeNumber: { in: FIELD_STAFF }, fieldStaff: true }, select: { id: true, employeeNumber: true } });
  const settings = await prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
  const interval = settings?.trackingIntervalMinutes ?? 5;
  let points = 0;
  for (const e of staff) {
    let record = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: e.id, date: today } } });
    if (record && (record.status === 'ON_LEAVE' || record.status === 'ABSENT')) continue;
    if (!record) {
      if (local < DEMO_DAY.start || local >= DEMO_DAY.end) continue;
      const offset = FIELD_STAFF.indexOf(e.employeeNumber) * 4; // 9:00, 9:04, 9:08…
      const checkIn = new Date(Math.min(now.getTime(), dayStart.getTime() + (DEMO_DAY.start + offset) * 60000));
      record = await prisma.attendanceRecord.create({ data: { organizationId, employeeId: e.id, date: today, checkIn, status: 'PRESENT', source: 'APP_CHECKIN' } });
    }
    if (!record.checkIn) continue;
    const closeAt = new Date(dayStart.getTime() + DEMO_DAY.end * 60000);
    if (!record.checkOut && now >= closeAt) {
      record = await prisma.attendanceRecord.update({ where: { id: record.id }, data: { checkOut: closeAt } });
    }
    points += (await fillDay(prisma, organizationId, e, record.checkIn!, record.checkOut ?? now, interval)).points;
  }
  return { points };
}
