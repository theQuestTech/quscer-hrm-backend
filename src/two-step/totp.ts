import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Time-based one-time codes (RFC 6238) — the 6-digit codes Google / Microsoft
 *  Authenticator show. A new code every 30 seconds from a shared secret. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function newSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, as the RFC recommends
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const n = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/** Checks a code, allowing one step either side for phone clocks that are a little off.
 *  Returns the step it matched so the caller can refuse the same code twice (replay). */
export function matchStep(secret: string, code: string, now = Date.now()): number | null {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    const expected = Buffer.from(codeAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(typed))) return s;
  }
  return null;
}

/** otpauth:// link the phone app reads from the QR code. */
export function otpauthUrl(secret: string, accountName: string, issuer = 'Quscer'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Ten one-use backup codes like 7KQ2-M9XD (no 0/O/1/I to avoid misreading). */
export function newBackupCodes(count = 10): string[] {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: count }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => chars[x % chars.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function normalizeBackupCode(code: string): string {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
