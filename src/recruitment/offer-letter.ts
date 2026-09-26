// Offer letter PDF. Plain and formal; HR prints or emails it and the
// candidate signs the acceptance at the bottom.

import * as PDFDocument from 'pdfkit';

export interface OfferLetterData {
  organizationName: string;
  candidateName: string;
  city: string | null;
  designation: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  salary: number;
  currency: string;
  joiningDate: Date;
  notes: string | null;
  issuedOn: Date;
}

const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERN: 'Internship',
};

export function formatLetterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}

export function offerLetterPdf(data: OfferLetterData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60, info: { Title: `Offer letter - ${data.candidateName}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const teal = '#00857a';
    doc.font('Helvetica-Bold').fontSize(18).fillColor(teal).text(data.organizationName);
    doc.moveTo(60, doc.y + 6).lineTo(535, doc.y + 6).strokeColor(teal).lineWidth(1.5).stroke();
    doc.moveDown(1.5);

    doc.font('Helvetica').fontSize(10.5).fillColor('#000');
    doc.text(formatLetterDate(data.issuedOn));
    doc.moveDown(1);
    doc.text(data.candidateName);
    if (data.city) doc.text(data.city);
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(12).text('Subject: Offer of employment');
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(10.5);
    doc.text(`Dear ${data.candidateName},`);
    doc.moveDown(0.6);
    doc.text(
      `We are pleased to offer you the position of ${data.designation} at ${data.organizationName}. ` +
        'The main terms of this offer are set out below.',
      { align: 'justify' },
    );
    doc.moveDown(1);

    const rows: [string, string][] = [
      ['Position', data.designation],
      ...(data.department ? ([['Department', data.department]] as [string, string][]) : []),
      ...(data.location ? ([['Location', data.location]] as [string, string][]) : []),
      ...(data.employmentType ? ([['Type', TYPE_LABEL[data.employmentType] ?? data.employmentType]] as [string, string][]) : []),
      ['Monthly basic salary', formatMoney(data.salary, data.currency)],
      ['Joining date', formatLetterDate(data.joiningDate)],
    ];
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font('Helvetica-Bold').text(label, 80, y, { width: 150 });
      doc.font('Helvetica').text(value, 240, y, { width: 295 });
      doc.moveDown(0.4);
    }
    doc.x = 60;
    doc.moveDown(0.8);

    if (data.notes) {
      doc.font('Helvetica-Bold').text('Other terms');
      doc.moveDown(0.3);
      doc.font('Helvetica').text(data.notes, { align: 'justify' });
      doc.moveDown(0.8);
    }

    doc.text(
      'Salary is subject to applicable income tax and statutory deductions. This offer depends on satisfactory ' +
        'verification of your documents and references. Please bring your original CNIC and educational ' +
        'certificates on your first day.',
      { align: 'justify' },
    );
    doc.moveDown(0.6);
    doc.text('Please sign below to confirm that you accept this offer. We look forward to welcoming you to the team.', { align: 'justify' });
    doc.moveDown(2);

    doc.text('Yours sincerely,');
    doc.moveDown(2.5);
    doc.text('______________________________');
    doc.text(`For ${data.organizationName}`);
    doc.moveDown(2);

    doc.font('Helvetica-Bold').text('Acceptance');
    doc.moveDown(0.4);
    doc.font('Helvetica').text(`I, ${data.candidateName}, accept this offer on the terms above.`);
    doc.moveDown(2);
    doc.text('Signature: ______________________        Date: ______________');

    doc.end();
  });
}
