import { createHmac } from 'crypto';
import { verifySvix } from './email-webhook';

const secretBytes = Buffer.from('test-secret-bytes-1234567890');
const secret = `whsec_${secretBytes.toString('base64')}`;
const sign = (id: string, ts: string, body: string) =>
  `v1,${createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')}`;

describe('verifySvix', () => {
  const body = '{"type":"email.delivered","data":{"email_id":"abc"}}';
  const now = 1_800_000_000;
  const ts = String(now);

  it('accepts a correct signature', () => {
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body) }, body, now)).toBe(true);
  });

  it('accepts when one of several signatures matches', () => {
    const signature = `v1,AAAA ${sign('msg_1', ts, body)}`;
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature }, body, now)).toBe(true);
  });

  it('refuses a changed body', () => {
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body) }, body + ' ', now)).toBe(false);
  });

  it('refuses an old timestamp', () => {
    const old = String(now - 3600);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: old, signature: sign('msg_1', old, body) }, body, now)).toBe(false);
  });

  it('refuses missing headers and the wrong secret', () => {
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts }, body, now)).toBe(false);
    const other = `whsec_${Buffer.from('another').toString('base64')}`;
    expect(verifySvix(other, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body) }, body, now)).toBe(false);
  });
});
