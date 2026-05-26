import { Injectable } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

@Injectable()
export class SchedulingPdfService {
  constructor(private readonly schedulingService: SchedulingService) {}

  async generate(eventId: string): Promise<Buffer> {
    const sapi = await this.schedulingService.getSchedule(eventId, 'SAPI');
    const kambing = await this.schedulingService.getSchedule(eventId, 'KAMBING_DOMBA');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).text('Jadwal Penyembelihan Idul Adha 1447H', { align: 'center' });
      doc.fontSize(10).text('Masjid Al Hijrah CGE', { align: 'center' });
      doc.moveDown();

      const startY = doc.y;
      const colWidth = (doc.page.width - 80) / 2;

      doc.fontSize(13).text('Tim SAPI', 40, startY, { width: colWidth, underline: true });
      doc.text('Tim KAMBING/DOMBA', 40 + colWidth, startY, { width: colWidth, underline: true });

      doc.moveDown();
      const tableY = doc.y;
      const rowH = 16;
      doc.fontSize(10);

      sapi.forEach((it, i) => {
        if (!it.animal.scheduledAt) return;
        const time = fmtTime(new Date(it.animal.scheduledAt));
        const name = it.pengkurban[0]?.name ?? '(vendor)';
        doc.text(`${time}  ${name}`, 40, tableY + i * rowH, { width: colWidth });
      });

      kambing.forEach((it, i) => {
        if (!it.animal.scheduledAt) return;
        const time = fmtTime(new Date(it.animal.scheduledAt));
        const name = it.pengkurban[0]?.name ?? '(vendor)';
        doc.text(`${time}  ${name}`, 40 + colWidth, tableY + i * rowH, { width: colWidth });
      });

      const now = new Date();
      doc.fontSize(8).text(
        `Generated ${now.toISOString()}`,
        40,
        doc.page.height - 40,
        { align: 'center', width: doc.page.width - 80 },
      );

      doc.end();
    });
  }
}
