import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { FieldEncryptionService } from './field-encryption.service';

function serviceWithKey(key: string | undefined) {
  const service = new FieldEncryptionService(
    new ConfigService(key === undefined ? {} : { FIELD_ENCRYPTION_KEY: key }),
  );
  service.onModuleInit();
  return service;
}

describe('FieldEncryptionService', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a value', () => {
    const service = serviceWithKey(key);
    const encrypted = service.encrypt('PK36HABB0000001234567890');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encrypted).not.toContain('1234567890');
    expect(service.decrypt(encrypted)).toBe('PK36HABB0000001234567890');
  });

  it('produces different ciphertext each time for the same value', () => {
    const service = serviceWithKey(key);
    expect(service.encrypt('123')).not.toBe(service.encrypt('123'));
  });

  it('rejects tampered ciphertext', () => {
    const service = serviceWithKey(key);
    const encrypted = service.encrypt('123456');
    const parts = encrypted.split(':');
    const data = Buffer.from(parts[4], 'base64');
    data[0] ^= 0xff;
    parts[4] = data.toString('base64');
    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('cannot be read with a different key', () => {
    const encrypted = serviceWithKey(key).encrypt('123456');
    const other = serviceWithKey(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('refuses to start without a key or with a wrong-sized key', () => {
    expect(() => serviceWithKey(undefined)).toThrow(/FIELD_ENCRYPTION_KEY is not set/);
    expect(() => serviceWithKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
