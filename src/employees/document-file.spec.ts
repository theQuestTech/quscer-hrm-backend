import { safeFileName, sniffDocumentType } from './employees.service';

describe('sniffDocumentType', () => {
  it('recognises PDF, JPG and PNG from their first bytes', () => {
    expect(sniffDocumentType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
  });

  it('rejects anything else, whatever it is called', () => {
    expect(sniffDocumentType(Buffer.from('<html><script>'))).toBeNull();
    expect(sniffDocumentType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });
});

describe('safeFileName', () => {
  it('strips unsafe characters and fixes the extension', () => {
    expect(safeFileName('my "cnic"\r\n.exe', 'image/png')).toBe('my _cnic_.png');
    expect(safeFileName('', 'application/pdf')).toBe('document.pdf');
  });
});
