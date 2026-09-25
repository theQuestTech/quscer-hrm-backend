import { toBankCsv } from './bank-file';

const row = {
  employeeNumber: 'EMP-001',
  employeeName: 'Bilal Khan',
  bankName: 'HBL',
  branchCode: null,
  accountTitle: 'Bilal "Bill" Khan',
  accountNumber: 'PK36HABB0000001234567890',
  amount: 134500,
  currency: 'PKR',
  reference: 'Salary Oct 2026',
};

describe('toBankCsv', () => {
  it('writes a header and one quoted line per payment', () => {
    const lines = toBankCsv([row]).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Account Number / IBAN"');
    expect(lines[1]).toBe(
      '"EMP-001","Bilal Khan","HBL","","Bilal ""Bill"" Khan","PK36HABB0000001234567890","134500.00","PKR","Salary Oct 2026"',
    );
  });

  it('neutralises values a spreadsheet would run as a formula', () => {
    const csv = toBankCsv([{ ...row, employeeName: '=HYPERLINK("http://x")' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});
