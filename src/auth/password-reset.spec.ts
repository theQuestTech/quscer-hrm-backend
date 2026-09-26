import { hashToken, newToken, resetEmail } from './password-reset';

describe('password reset links', () => {
  it('makes long random tokens and stores only a hash', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });

  it('email has the link and escapes the name', () => {
    const e = resetEmail('<b>Sara</b>', 'https://hrm.quscer.com/reset-password?token=abc');
    expect(e.html).toContain('https://hrm.quscer.com/reset-password?token=abc');
    expect(e.html).not.toContain('<b>Sara</b>');
    expect(e.html).toContain('&lt;b&gt;Sara&lt;/b&gt;');
    expect(e.text).toContain('expires in 60 minutes');
  });
});
