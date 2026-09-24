// WBS 6.12 — field-level encryption for sensitive values (bank account
// numbers today). AES-256-GCM with a key from FIELD_ENCRYPTION_KEY
// (32 bytes, base64). Ciphertext format: "enc:v1:<iv>:<tag>:<data>", all
// base64 — the version prefix leaves room for key rotation later.
//
// The key is checked at startup, not on first use: a missing key should stop
// a deploy, not surface as a 500 the first time HR saves bank details.

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

@Injectable()
export class FieldEncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.get<string>('FIELD_ENCRYPTION_KEY');
    if (!raw) {
      throw new Error(
        'FIELD_ENCRYPTION_KEY is not set. Generate one with: ' +
          `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    }
    this.key = key;
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  decrypt(value: string): string {
    if (!this.isEncrypted(value)) return value; // legacy plaintext row — see scripts/encrypt-bank-details.ts
    const [iv, tag, data] = value.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
