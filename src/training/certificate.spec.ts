import { certificatePdf } from './certificate';

describe('certificatePdf', () => {
  it('makes a one-page PDF', async () => {
    const pdf = await certificatePdf({
      organizationName: 'Acme Traders', employeeName: 'Bilal Khan', courseTitle: 'Fire Safety', completedAt: new Date('2026-10-01'),
      hours: 4, expiresAt: new Date('2027-10-01'), certificateId: 'abc123',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1);
  });
});
