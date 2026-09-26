import type { Request } from 'express';

// Behind Railway's proxy the visitor's address is the last one added to
// X-Forwarded-For (earlier entries can be made up by the visitor).
export function visitorAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] ?? req.socket.remoteAddress ?? 'unknown';
}
