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
      const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 36 });
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc.fontSize(16).fillColor('#000').text('Jadwal Penyembelihan Idul Adha 1447H', { align: 'center' });
      doc.fontSize(9).fillColor('#444').text('Masjid Al Hijrah CGE', { align: 'center' });
      doc.moveDown(0.8);

      const renderSection = (
        title: string,
        items: Array<{ animal: any; sohibulRequests: any[] }>,
      ) => {
        doc.fontSize(12).fillColor('#000').text(`Tim ${title} (${items.length} hewan)`, { underline: true });
        doc.moveDown(0.3);
        for (const it of items) {
          if (!it.animal.scheduledAt) continue;
          const time = fmtTime(new Date(it.animal.scheduledAt));
          const firstName = it.sohibulRequests[0]?.name ?? '(vendor)';
          const permItems: Permintaan[] = it.sohibulRequests.map((s: any) => ({
            hak: s.hak,
            permintaanKhusus: s.permintaanKhusus,
            catatanSebagian: s.catatanSebagian,
            catatanPanitia: s.catatanPanitia,
            maranos: s.maranos ?? '',
            name: it.sohibulRequests.length > 1 ? s.name : undefined,
          }));
          const summary = summarizePermintaan(permItems);
          doc.fontSize(10).fillColor('#000').text(`${time}  ${firstName}`, { continued: false });
          if (summary && summary !== '—') {
            doc.fontSize(8).fillColor('#666').text(`        ${summary}`);
          }
          doc.moveDown(0.15);
        }
        doc.moveDown(0.5);
      };

      renderSection('SAPI', sapi);
      renderSection('KAMBING/DOMBA', kambing);

      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${fmtTime(now)} WIB`;
      doc.fontSize(7).fillColor('#888').text(`Generated ${stamp}`, { align: 'center' });

      doc.end();
    });
  }
}
