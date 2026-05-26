import { Injectable } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { summarizePermintaan, Permintaan } from './scheduling-mappers';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

@Injectable()
export class SchedulingPdfService {
  constructor(private readonly schedulingService: SchedulingService) {}

  async generate(eventId: string): Promise<Buffer> {
    const sapi = await this.schedulingService.getSesetData(eventId, 'SAPI');
    const kambing = await this.schedulingService.getSesetData(eventId, 'KAMBING_DOMBA');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc.fontSize(18).text('Jadwal Penyembelihan Idul Adha 1447H', { align: 'center' });
      doc.fontSize(10).text('Masjid Al Hijrah CGE', { align: 'center' });
      doc.moveDown();

      const startY = doc.y;
      const colWidth = (doc.page.width - 80) / 2;

      doc.fontSize(13).text('Tim SAPI', 40, startY, { width: colWidth, underline: true });
      doc.text('Tim KAMBING/DOMBA', 40 + colWidth, startY, { width: colWidth, underline: true });

      doc.moveDown();
      const tableY = doc.y;
      const rowH = 24;

      const renderColumn = (
        items: Array<{ animal: any; sohibulRequests: any[] }>,
        x: number,
      ) => {
        items.forEach((it, i) => {
          if (!it.animal.scheduledAt) return;
          const time = fmtTime(new Date(it.animal.scheduledAt));
          const firstName = it.sohibulRequests[0]?.name ?? '(vendor)';
          const permItems: Permintaan[] = it.sohibulRequests.map((s: any) => ({
            hak: s.hak,
            permintaanKhusus: s.permintaanKhusus,
            catatanSebagian: s.catatanSebagian,
            catatanPanitia: s.catatanPanitia,
            name: it.sohibulRequests.length > 1 ? s.name : undefined,
          }));
          const summary = summarizePermintaan(permItems);
          doc.fontSize(10).fillColor('#000').text(
            `${time}  ${firstName}`,
            x,
            tableY + i * rowH,
            { width: colWidth },
          );
          doc.fontSize(8).fillColor('#666').text(
            `Permintaan: ${summary}`,
            x,
            tableY + i * rowH + 12,
            { width: colWidth },
          );
          doc.fillColor('#000');
        });
      };

      renderColumn(sapi, 40);
      renderColumn(kambing, 40 + colWidth);

      const now = new Date();
      doc.fontSize(8).fillColor('#888').text(
        `Generated ${now.toISOString()}`,
        40,
        doc.page.height - 40,
        { align: 'center', width: doc.page.width - 80 },
      );

      doc.end();
    });
  }
}
