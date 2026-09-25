// WBS 4.10 — payslip PDF generation. Deliberately plain: no logo, no
// per-org branding/template customization yet — that's a real feature
// (matches the branding-pass pattern already done for Quscer OS invoices)
// but a separate piece of work, not bundled into "produce a correct PDF."

import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';

interface PayslipData {
  organizationName: string;
  employeeName: string;
  employeeNumber: string;
  designation: string;
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;
  currency: string;
  grossSalary: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  breakdown: Array<{ label: string; type: string; amount: number }>;
}

@Injectable()
export class PayslipPdfService {
  generate(data: PayslipData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).font('Helvetica-Bold').text(data.organizationName);
      doc.fontSize(11).font('Helvetica').fillColor('#666666')
        .text('Payslip', { continued: false });
      doc.moveDown(1);

      // Employee + period info
      doc.fillColor('#000000').fontSize(10);
      const infoTop = doc.y;
      doc.font('Helvetica-Bold').text('Employee:', 50, infoTop);
      doc.font('Helvetica').text(`${data.employeeName} (${data.employeeNumber})`, 150, infoTop);
      doc.font('Helvetica-Bold').text('Designation:', 50, infoTop + 16);
      doc.font('Helvetica').text(data.designation, 150, infoTop + 16);
      doc.font('Helvetica-Bold').text('Pay Period:', 50, infoTop + 32);
      doc.font('Helvetica').text(
        `${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}`,
        150, infoTop + 32,
      );
      doc.font('Helvetica-Bold').text('Pay Date:', 50, infoTop + 48);
      doc.font('Helvetica').text(formatDate(data.payDate), 150, infoTop + 48);

      doc.moveDown(4);

      // Earnings / Deductions tables side-by-side would be nicer, but a
      // single ordered list keeps this simple and correct for a first
      // version — revisit layout once real payslips are being reviewed.
      doc.font('Helvetica-Bold').fontSize(11).text('Earnings', 50, doc.y);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      for (const line of data.breakdown.filter((l) => l.type === 'earning')) {
        row(doc, line.label, line.amount, data.currency);
      }
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(11).text('Deductions');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      for (const line of data.breakdown.filter(
        (l) => l.type === 'statutory_deduction' || l.type === 'loan_deduction' || l.type === 'deduction',
      )) {
        row(doc, line.label, -line.amount, data.currency);
      }

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(10);
      row(doc, 'Gross Salary', data.grossSalary, data.currency, true);
      row(doc, 'Total Deductions', -data.totalDeductions, data.currency, true);
      doc.fontSize(13);
      row(doc, 'Net Salary', data.netSalary, data.currency, true);

      // Employer contributions — shown for transparency but not part of
      // gross/net math (they don't reduce the employee's pay).
      const employerLines = data.breakdown.filter((l) => l.type === 'employer_contribution');
      if (employerLines.length > 0) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666')
          .text('Employer Contributions (informational, not deducted from your pay)');
        doc.font('Helvetica').fontSize(9);
        for (const line of employerLines) {
          row(doc, line.label, line.amount, data.currency);
        }
        doc.fillColor('#000000');
      }

      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999999')
        .text('This is a system-generated payslip.', 50, doc.y);

      doc.end();
    });
  }

  // WBS 4.14 — final settlement statement, same plain style as a payslip.
  generateSettlement(data: SettlementPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).font('Helvetica-Bold').text(data.organizationName);
      doc.fontSize(11).font('Helvetica').fillColor('#666666').text(`Final settlement (${data.status.toLowerCase()})`);
      doc.moveDown(1);

      doc.fillColor('#000000').fontSize(10);
      const top = doc.y;
      const info: [string, string][] = [
        ['Employee:', `${data.employeeName} (${data.employeeNumber})`],
        ['Designation:', data.designation],
        ['Joined:', formatDate(data.dateOfJoining)],
        ['Last working day:', formatDate(data.lastWorkingDay)],
        ['Reason:', data.reason.replace(/_/g, ' ').toLowerCase()],
      ];
      info.forEach(([label, value], i) => {
        doc.font('Helvetica-Bold').text(label, 50, top + i * 16);
        doc.font('Helvetica').text(value, 170, top + i * 16);
      });
      doc.y = top + info.length * 16;
      doc.moveDown(1.5);

      doc.font('Helvetica-Bold').fontSize(11).text('Earnings', 50, doc.y);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      for (const line of data.breakdown.filter((l) => l.type === 'earning')) {
        row(doc, line.label, line.amount, data.currency);
      }
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text('Deductions', 50, doc.y);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      for (const line of data.breakdown.filter((l) => l.type !== 'earning')) {
        row(doc, line.label, -line.amount, data.currency);
      }

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10);
      row(doc, 'Total earnings', data.totalEarnings, data.currency, true);
      row(doc, 'Total deductions', -data.totalDeductions, data.currency, true);
      doc.fontSize(13);
      row(doc, data.netAmount < 0 ? 'Amount owed by employee' : 'Net amount payable', data.netAmount, data.currency, true);

      if (data.notes.length > 0) {
        doc.moveDown(1);
        doc.font('Helvetica').fontSize(8).fillColor('#666666');
        for (const note of data.notes) doc.text(`• ${note}`, 50, doc.y, { width: 495 });
        doc.fillColor('#000000');
      }

      doc.moveDown(3);
      doc.fontSize(10).font('Helvetica');
      const signY = doc.y;
      doc.text('______________________', 50, signY);
      doc.text('______________________', 350, signY);
      doc.text('Employee', 50, signY + 14);
      doc.text('For the company', 350, signY + 14);

      doc.end();
    });
  }
}

interface SettlementPdfData {
  organizationName: string;
  employeeName: string;
  employeeNumber: string;
  designation: string;
  dateOfJoining: Date;
  lastWorkingDay: Date;
  reason: string;
  status: string;
  currency: string;
  totalEarnings: number;
  totalDeductions: number;
  netAmount: number;
  breakdown: Array<{ label: string; type: string; amount: number }>;
  notes: string[];
}

function row(doc: PDFKit.PDFDocument, label: string, amount: number, currency: string, bold = false) {
  const y = doc.y;
  doc.text(label, 50, y);
  doc.text(
    `${amount < 0 ? '-' : ''}${currency} ${Math.abs(amount).toFixed(2)}`,
    400, y, { width: 145, align: 'right' },
  );
  doc.moveDown(bold ? 0.6 : 0.4);
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
