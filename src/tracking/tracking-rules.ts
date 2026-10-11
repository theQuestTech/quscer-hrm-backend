// Field tracking rules, kept free of the database so they're easy to test.
//
// A field person's phone sends its position every few minutes while they're
// checked in. Positions taken outside a checked-in period are never kept:
// tracking is for working hours only.

import { distanceMeters } from '../attendance-devices/punch-rules';

export interface Point {
  at: Date;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export interface WorkWindow {
  checkIn: Date;
  checkOut: Date | null; // null = still checked in
}

// Positions older than this are refused (a phone that was off for days).
export const MAX_AGE_HOURS = 48;
// A phone clock a little ahead is fine; further ahead is wrong.
const FUTURE_ALLOWANCE_MS = 2 * 60 * 1000;
// Worse than this, the position says nothing useful.
export const WORST_ACCURACY_METRES = 2000;

// Which positions to keep: inside a checked-in period, not in the future, not
// too old, a sensible place and accuracy, one per moment.
export function acceptPoints<T extends Point>(points: T[], windows: WorkWindow[], now: Date): { kept: T[]; ignored: number } {
  const seen = new Set<number>();
  const kept: T[] = [];
  for (const p of points) {
    const t = p.at.getTime();
    const ok =
      Number.isFinite(t) &&
      t <= now.getTime() + FUTURE_ALLOWANCE_MS &&
      t >= now.getTime() - MAX_AGE_HOURS * 3600_000 &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180 &&
      !(p.latitude === 0 && p.longitude === 0) && // "no fix" on some phones
      (p.accuracy == null || p.accuracy <= WORST_ACCURACY_METRES) &&
      windows.some((w) => t >= w.checkIn.getTime() && t <= (w.checkOut ?? now).getTime() + FUTURE_ALLOWANCE_MS) &&
      !seen.has(t);
    if (ok) {
      seen.add(t);
      kept.push(p);
    }
  }
  return { kept, ignored: points.length - kept.length };
}

export type LiveStatus =
  | 'NOT_CHECKED_IN' // off duty: not tracked
  | 'WAITING' // just checked in, first position not in yet
  | 'LIVE' // positions arriving
  | 'LOCATION_OFF' // the phone said location is off or not allowed
  | 'NO_SIGNAL'; // checked in but nothing heard for a while

// How long without a position before it counts as "no signal": three missed
// positions, but never less than 15 minutes (phones save battery when still).
export function silentMinutes(intervalMinutes: number) {
  return Math.max(15, 3 * intervalMinutes);
}

export function liveStatus(o: {
  checkedInAt: Date | null; // the open check-in, if any
  lastPointAt: Date | null;
  lastEvent: { at: Date; kind: string } | null;
  intervalMinutes: number;
  now: Date;
}): { status: LiveStatus; since: Date | null } {
  if (!o.checkedInAt) return { status: 'NOT_CHECKED_IN', since: null };
  const off = o.lastEvent && o.lastEvent.kind !== 'LOCATION_ON' && o.lastEvent.at >= o.checkedInAt;
  if (off && (!o.lastPointAt || o.lastEvent!.at > o.lastPointAt)) return { status: 'LOCATION_OFF', since: o.lastEvent!.at };
  const limit = silentMinutes(o.intervalMinutes) * 60_000;
  const last = o.lastPointAt && o.lastPointAt >= o.checkedInAt ? o.lastPointAt : null;
  if (last) {
    return o.now.getTime() - last.getTime() <= limit ? { status: 'LIVE', since: last } : { status: 'NO_SIGNAL', since: last };
  }
  return o.now.getTime() - o.checkedInAt.getTime() <= limit
    ? { status: 'WAITING', since: o.checkedInAt }
    : { status: 'NO_SIGNAL', since: o.checkedInAt };
}

// Faster than this between two positions is a GPS jump, not travel.
const MAX_SPEED_KMH = 200;
// Positions this unsure aren't used for distance.
const DISTANCE_ACCURACY = 100;
// A stop: stayed within this distance for at least this long.
export const STOP_RADIUS_METRES = 100;
export const STOP_MINUTES = 10;

export interface Stop {
  arrivedAt: Date;
  leftAt: Date;
  minutes: number;
  latitude: number;
  longitude: number;
}

// The day's route in numbers: distance travelled and where they stopped.
export function routeSummary(points: Point[]): { distanceKm: number; stops: Stop[] } {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const good = sorted.filter((p) => p.accuracy == null || p.accuracy <= DISTANCE_ACCURACY);

  // A jump is dropped, and the next position is measured from the last real one.
  let metres = 0;
  let from = good[0];
  for (let i = 1; i < good.length; i++) {
    const d = distanceMeters(from, good[i]);
    const hours = (good[i].at.getTime() - from.at.getTime()) / 3600_000;
    if (hours <= 0 || d / 1000 / hours > MAX_SPEED_KMH) continue;
    if (d < 20) continue; // standing still: GPS wobble
    metres += d;
    from = good[i];
  }

  const stops: Stop[] = [];
  let i = 0;
  while (i < good.length) {
    let j = i;
    while (j + 1 < good.length && distanceMeters(good[i], good[j + 1]) <= STOP_RADIUS_METRES) j++;
    const minutes = (good[j].at.getTime() - good[i].at.getTime()) / 60_000;
    if (minutes >= STOP_MINUTES) {
      const group = good.slice(i, j + 1);
      stops.push({
        arrivedAt: good[i].at,
        leftAt: good[j].at,
        minutes: Math.round(minutes),
        latitude: group.reduce((s, p) => s + p.latitude, 0) / group.length,
        longitude: group.reduce((s, p) => s + p.longitude, 0) / group.length,
      });
      i = j + 1;
    } else {
      i++;
    }
  }
  return { distanceKm: Math.round(metres / 100) / 10, stops };
}
