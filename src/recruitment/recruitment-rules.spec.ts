import { ApplicationStage } from '@prisma/client';
import { RateLimiter, SLUG_PATTERN, acceptingApplications, canMoveTo, cvFileName, slugify, sniffCvType } from './recruitment-rules';

describe('sniffCvType', () => {
  it('accepts PDF, .doc and .docx by their first bytes', () => {
    expect(sniffCvType(Buffer.from('%PDF-1.4 ...'))?.ext).toBe('pdf');
    expect(sniffCvType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))?.ext).toBe('doc');
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml')]);
    expect(sniffCvType(docx)?.ext).toBe('docx');
  });

  it('rejects images, other zips and scripts', () => {
    expect(sniffCvType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffCvType(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('evil.exe')]))).toBeNull();
    expect(sniffCvType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });
});

describe('cvFileName', () => {
  it('builds a safe name', () => {
    expect(cvFileName('Sara', 'Ali"\r\n', 'pdf')).toBe('Sara Ali_ CV.pdf');
  });
});

describe('slugify', () => {
  it('makes a web address from the company name', () => {
    expect(slugify('Acme Traders (Pvt) Ltd.')).toBe('acme-traders-pvt-ltd');
    expect(slugify('AB')).toBe('company-ab');
    expect(slugify('کمپنی')).toBe('company-jobs');
    expect(SLUG_PATTERN.test(slugify('A'.repeat(80)))).toBe(true);
  });

  it('pattern rejects bad addresses', () => {
    expect(SLUG_PATTERN.test('acme-traders')).toBe(true);
    expect(SLUG_PATTERN.test('-acme')).toBe(false);
    expect(SLUG_PATTERN.test('Acme')).toBe(false);
    expect(SLUG_PATTERN.test('ab')).toBe(false);
  });
});

describe('canMoveTo', () => {
  it('only Hire can make someone HIRED, and hired people stay hired', () => {
    expect(canMoveTo(ApplicationStage.OFFER, ApplicationStage.HIRED)).toBe(false);
    expect(canMoveTo(ApplicationStage.HIRED, ApplicationStage.REJECTED)).toBe(false);
    expect(canMoveTo(ApplicationStage.REJECTED, ApplicationStage.SCREENING)).toBe(true);
    expect(canMoveTo(ApplicationStage.APPLIED, ApplicationStage.APPLIED)).toBe(false);
  });
});

describe('acceptingApplications', () => {
  const now = new Date('2026-10-10T15:00:00Z');
  it('open jobs accept until the end of the closing day', () => {
    expect(acceptingApplications({ status: 'OPEN', closesAt: null }, now)).toBe(true);
    expect(acceptingApplications({ status: 'OPEN', closesAt: new Date('2026-10-10') }, now)).toBe(true);
    expect(acceptingApplications({ status: 'OPEN', closesAt: new Date('2026-10-09') }, now)).toBe(false);
    expect(acceptingApplications({ status: 'DRAFT', closesAt: null }, now)).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('blocks after the limit and lets through again later', () => {
    const r = new RateLimiter(2, 1000);
    expect(r.allow('ip', 0)).toBe(true);
    expect(r.allow('ip', 10)).toBe(true);
    expect(r.allow('ip', 20)).toBe(false);
    expect(r.allow('other', 20)).toBe(true);
    expect(r.allow('ip', 1500)).toBe(true);
  });
});
