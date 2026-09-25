// WBS 4.11 — bank-neutral payment file. A plain CSV that HR uploads to (or
// copies into) their bank's bulk-transfer portal. Pakistani banks each have
// their own template; this is the common set of columns they all need, and a
// bank-specific layout can be added later as another formatter over the same
// rows.

export interface BankFileRow {
  employeeNumber: string;
  employeeName: string;
  bankName: string;
  branchCode: string | null;
  accountTitle: string;
  accountNumber: string;
  amount: number;
  currency: string;
  reference: string;
}

const HEADER = [
  'Employee Number',
  'Employee Name',
  'Bank',
  'Branch Code',
  'Account Title',
  'Account Number / IBAN',
  'Amount',
  'Currency',
  'Reference',
];

// Quote every field, and neutralise values a spreadsheet would treat as a
// formula (=, +, -, @) so opening the file in Excel can't run anything.
function csvField(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toBankCsv(rows: BankFileRow[]): string {
  const lines = [
    HEADER.map(csvField).join(','),
    ...rows.map((r) =>
      [
        r.employeeNumber,
        r.employeeName,
        r.bankName,
        r.branchCode,
        r.accountTitle,
        r.accountNumber,
        r.amount.toFixed(2),
        r.currency,
        r.reference,
      ]
        .map(csvField)
        .join(','),
    ),
  ];
  return lines.join('\r\n') + '\r\n';
}
