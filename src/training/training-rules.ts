// Small, pure rules for training — kept here so they can be unit-tested.

const DAY = 24 * 60 * 60 * 1000;

// Certificates warn this many days before they expire.
export const EXPIRING_SOON_DAYS = 60;

// Completion date + N months, kept on the same day of the month where it
// exists (31 Jan + 1 month = 28/29 Feb, not 3 March).
export function certificateExpiry(completedAt: Date, validityMonths: number | null | undefined): Date | null {
  if (!validityMonths) return null;
  const y = completedAt.getUTCFullYear();
  const m = completedAt.getUTCMonth() + validityMonths;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(completedAt.getUTCDate(), lastDay)));
}

export type CertificateState = 'NONE' | 'VALID' | 'EXPIRING' | 'EXPIRED';

export function certificateState(expiresAt: Date | null, now = new Date()): CertificateState {
  if (!expiresAt) return 'NONE';
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (expiresAt.getTime() < today) return 'EXPIRED';
  if (expiresAt.getTime() - today <= EXPIRING_SOON_DAYS * DAY) return 'EXPIRING';
  return 'VALID';
}

// Hours credited for completing: the course's set length, or the session's
// length (rounded to the nearest half hour) when the course has none.
export function creditedHours(courseHours: number | null | undefined, startsAt?: Date, endsAt?: Date): number | null {
  if (courseHours && courseHours > 0) return courseHours;
  if (!startsAt || !endsAt || endsAt <= startsAt) return null;
  return Math.round(((endsAt.getTime() - startsAt.getTime()) / 3_600_000) * 2) / 2;
}

// Everyone enrolled plus the new people must fit in the room.
export function seatsLeft(capacity: number | null | undefined, taken: number): number | null {
  if (!capacity) return null;
  return Math.max(0, capacity - taken);
}
