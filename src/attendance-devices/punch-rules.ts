// Small, pure rules for attendance machines and check-in limits — kept here
// so they can be unit-tested.

import { BlockList, isIP } from 'net';
import { localDayAndMinutes } from '../common/dates';

const DAY = 24 * 60 * 60 * 1000;

// --- Office network -----------------------------------------------------------

// "::ffff:1.2.3.4" (IPv4 seen through IPv6) → "1.2.3.4"
export function normalizeIp(ip: string): string {
  const t = ip.trim();
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(t) ? t.slice(7) : t;
}

// One address or a range: "39.45.10.20", "39.45.10.0/24", "2400:adc0::/32".
export function parseCidr(cidr: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [addr, bits, extra] = cidr.trim().split('/');
  if (extra !== undefined) return null;
  const address = normalizeIp(addr ?? '');
  const v = isIP(address);
  if (!v) return null;
  const max = v === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (bits !== undefined && !/^\d+$/.test(bits))) return null;
  return { address, prefix, family: v === 4 ? 'ipv4' : 'ipv6' };
}

export function ipAllowed(ip: string, cidrs: string[]): boolean {
  const addr = normalizeIp(ip);
  const v = isIP(addr);
  if (!v) return false;
  const list = new BlockList();
  for (const c of cidrs) {
    const p = parseCidr(c);
    if (p) list.addSubnet(p.address, p.prefix, p.family);
  }
  return list.check(addr, v === 4 ? 'ipv4' : 'ipv6');
}

// --- Office location (GPS) ----------------------------------------------------

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Phones report how sure they are (accuracy, in metres). Give the benefit of
// the doubt up to 100 m, so a weak signal indoors doesn't lock people out,
// but a far-away phone can't claim a huge "accuracy" to get in.
export const MAX_ACCURACY_ALLOWANCE = 100;

export function nearestOffice<T extends { latitude: number; longitude: number; radiusMeters: number }>(
  point: { latitude: number; longitude: number; accuracy?: number | null },
  offices: T[],
): { office: T; distance: number; inside: boolean } | null {
  let best: { office: T; distance: number; inside: boolean } | null = null;
  const allowance = Math.min(Math.max(point.accuracy ?? 0, 0), MAX_ACCURACY_ALLOWANCE);
  for (const o of offices) {
    const distance = distanceMeters(point, o);
    const inside = distance <= o.radiusMeters + allowance;
    if (!best || (inside && !best.inside) || (inside === best.inside && distance < best.distance)) best = { office: o, distance, inside };
  }
  return best;
}

// --- Who may use the app button, and where ------------------------------------

export type CheckInMethod = 'APP' | 'MACHINE' | 'BOTH';

export function effectiveRules(
  employee: { checkInMethod: string | null; requireOfficeNetwork: boolean | null; requireOfficeLocation: boolean | null },
  company: { defaultCheckInMethod: string; defaultRequireOfficeNetwork: boolean; defaultRequireOfficeLocation: boolean },
) {
  const method = (employee.checkInMethod ?? company.defaultCheckInMethod) as CheckInMethod;
  return {
    method,
    canUseApp: method !== 'MACHINE',
    needsOfficeNetwork: employee.requireOfficeNetwork ?? company.defaultRequireOfficeNetwork,
    needsOfficeLocation: employee.requireOfficeLocation ?? company.defaultRequireOfficeLocation,
  };
}

// --- Machine punches ------------------------------------------------------------

export interface RawPunch {
  machineUserId: string;
  wallTime: string; // "YYYY-MM-DD HH:mm:ss", the machine's local time
  kind: 'IN' | 'OUT' | null;
}

// ZKTeco ADMS "ATTLOG" upload: one punch per line, tab-separated —
//   PIN  YYYY-MM-DD HH:MM:SS  STATUS  VERIFY  WORKCODE  …
// STATUS 0 = check in, 1 = check out (others: break/overtime).
export function parseAttlog(body: string): RawPunch[] {
  const out: RawPunch[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const pin = cols[0]?.trim();
    const time = cols[1]?.trim();
    if (!pin || !time || !/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2})?$/.test(time)) continue;
    const status = cols[2]?.trim();
    out.push({ machineUserId: pin, wallTime: time, kind: status === '0' ? 'IN' : status === '1' ? 'OUT' : null });
  }
  return out;
}

// Machine IDs are compared as written, minus spaces and leading zeros
// ("00012" on the machine = "12" in HRM).
export function normalizeMachineId(id: string): string {
  const t = String(id).trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

// Which attendance day a punch counts for. Normally its local date; on an
// overnight shift (e.g. 22:00–06:00), punches until 4 hours after the shift
// ends belong to the day the shift started.
export function workDateFor(
  punchedAt: Date,
  timeZone: string | null | undefined,
  shift: { startTime: string; endTime: string } | null,
): Date {
  const { day, minutes } = localDayAndMinutes(punchedAt, timeZone);
  if (shift) {
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end < start && minutes < end + 240) return new Date(day.getTime() - DAY);
  }
  return day;
}

// First punch in, last punch out (only if it's at least a minute later).
export function dayTimes(punches: Date[]): { checkIn: Date | null; checkOut: Date | null } {
  if (!punches.length) return { checkIn: null, checkOut: null };
  const sorted = [...punches].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return { checkIn: first, checkOut: last.getTime() - first.getTime() >= 60_000 ? last : null };
}
