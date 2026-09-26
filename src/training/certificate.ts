// Certificate of completion (PDF). Landscape, plain and printable.

import * as PDFDocument from 'pdfkit';
import { formatLetterDate } from '../recruitment/offer-letter';

export interface CertificateData {
  organizationName: string;
  employeeName: string;
  courseTitle: string;
  completedAt: Date;
  hours: number | null;
  expiresAt: Date | null;
  certificateId: string;
}

export function certificatePdf(d: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50, info: { Title: `Certificate - ${d.employeeName}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const teal = '#00857a';
    const w = doc.page.width;
    const h = doc.page.height;
    doc.rect(25, 25, w - 50, h - 50).lineWidth(3).strokeColor(teal).stroke();
    doc.rect(33, 33, w - 66, h - 66).lineWidth(0.8).strokeColor('#9fd9d3').stroke();

    const center = { align: 'center' as const, width: w - 100 };
    doc.fillColor(teal).font('Helvetica-Bold').fontSize(16).text(d.organizationName.toUpperCase(), 50, 80, center);
    doc.moveDown(1.2);
    doc.fillColor('#1a1a2e').font('Helvetica-Bold').fontSize(34).text('Certificate of Completion', center);
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(13).fillColor('#555').text('This is to certify that', center);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(28).fillColor('#1a1a2e').text(d.employeeName, center);
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(13).fillColor('#555').text('has successfully completed', center);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(teal).text(d.courseTitle, center);
    doc.moveDown(1);
    const facts = [
      `Completed on ${formatLetterDate(d.completedAt)}`,
      d.hours ? `${d.hours} training hour${d.hours === 1 ? '' : 's'}` : null,
      d.expiresAt ? `Valid until ${formatLetterDate(d.expiresAt)}` : null,
    ].filter(Boolean).join('   ·   ');
    doc.font('Helvetica').fontSize(12).fillColor('#333').text(facts, center);

    const y = h - 130;
    doc.moveTo(w / 2 - 120, y).lineTo(w / 2 + 120, y).lineWidth(0.8).strokeColor('#333').stroke();
    doc.font('Helvetica').fontSize(11).fillColor('#333').text(`For ${d.organizationName}`, 50, y + 8, center);
    doc.fontSize(8).fillColor('#999').text(`Certificate ID ${d.certificateId}`, 50, h - 60, center);
    doc.end();
  });
}
