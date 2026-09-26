import { formatLetterDate, formatMoney, offerLetterPdf } from './offer-letter';

describe('offer letter', () => {
  it('formats money and dates the Pakistani way', () => {
    expect(formatMoney(150000, 'PKR')).toBe('PKR 150,000');
    expect(formatLetterDate(new Date('2026-11-02T00:00:00Z'))).toBe('2 November 2026');
  });

  it('makes a PDF', async () => {
    const pdf = await offerLetterPdf({
      organizationName: 'Acme Traders', candidateName: 'Sara Ali', city: 'Lahore', designation: 'Sales Executive',
      department: 'Sales', location: 'Lahore Head Office', employmentType: 'FULL_TIME', salary: 90000, currency: 'PKR',
      joiningDate: new Date('2026-11-02'), notes: 'Three months probation.', issuedOn: new Date('2026-10-01'),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
