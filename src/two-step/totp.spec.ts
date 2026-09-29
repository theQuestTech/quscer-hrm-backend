import { base32Decode, base32Encode, codeAt, matchStep, newBackupCodes, newSecret, normalizeBackupCode, otpauthUrl } from './totp';

describe('TOTP', () => {
  // RFC 6238 test vector: ASCII "12345678901234567890", SHA1, T=59s -> 94287082 (8 digits) -> 287082
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    expect(codeAt(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeAt(rfcSecret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('base32 round-trips', () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('accepts the current code and one step either side, nothing further', () => {
    const s = newSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(matchStep(s, codeAt(s, step), now)).toBe(step);
    expect(matchStep(s, codeAt(s, step - 1), now)).toBe(step - 1);
    expect(matchStep(s, codeAt(s, step + 1), now)).toBe(step + 1);
    expect(matchStep(s, codeAt(s, step - 3), now)).toBeNull();
    expect(matchStep(s, '12345', now)).toBeNull();
    expect(matchStep(s, 'abcdef', now)).toBeNull();
  });

  it('builds an otpauth link and readable backup codes', () => {
    expect(otpauthUrl('ABC', 'a@b.pk')).toBe('otpauth://totp/Quscer%3Aa%40b.pk?secret=ABC&issuer=Quscer&algorithm=SHA1&digits=6&period=30');
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/));
    expect(normalizeBackupCode(' 7kq2 m9xd ')).toBe('7KQ2M9XD');
  });
});
