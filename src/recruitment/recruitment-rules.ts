// Small, pure rules for recruitment — kept here so they can be unit-tested.

import { ApplicationStage } from '@prisma/client';

export const MAX_CV_BYTES = 5 * 1024 * 1024;

// PDF, old Word (.doc) or new Word (.docx), checked from the file's first
// bytes rather than the name the browser sent. Downloads are always sent as
// attachments, so a file is never shown inside the app.
export function sniffCvType(buffer: Buffer): { mimeType: string; ext: string } | null {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { mimeType: 'application/pdf', ext: 'pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return { mimeType: 'application/msword', ext: 'doc' };
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && buffer.includes(Buffer.from('word/'))) {
    return { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  }
  return null;
}

export function cvFileName(firstName: string, lastName: string, ext: string): string {
  const base = `${firstName} ${lastName} CV`.replace(/[^A-Za-z0-9._\- ]+/g, '_').trim().slice(0, 80) || 'CV';
  return `${base}.${ext}`;
}

// "Acme Traders (Pvt) Ltd." → "acme-traders-pvt-ltd"
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug.length >= 3 ? slug : `company-${slug || 'jobs'}`;
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// HIRED only happens through "Hire" (it creates the employee), and a hired
// person can't be moved again. Anything else can move anywhere, including
// back from REJECTED if HR changes their mind.
export function canMoveTo(from: ApplicationStage, to: ApplicationStage): boolean {
  if (from === ApplicationStage.HIRED || to === ApplicationStage.HIRED) return false;
  return from !== to;
}

// Open to applicants: OPEN and not past its closing date (the whole closing
// day still counts).
export function acceptingApplications(job: { status: string; closesAt: Date | null }, now = new Date()): boolean {
  if (job.status !== 'OPEN') return false;
  if (!job.closesAt) return true;
  const endOfDay = new Date(job.closesAt);
  endOfDay.setUTCHours(23, 59, 59, 999);
  return now <= endOfDay;
}

// A simple per-address limit for the public apply form: at most `limit`
// tries in `windowMs`. In memory, so it resets when the server restarts —
// enough to stop a script flooding one company with applications.
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}
