import { Injectable } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

@Injectable()
export class SchedulingSesetPdfService {
  constructor(private readonly schedulingService: SchedulingService) {}

  async generate(eventId: string): Promise<Buffer> {
    const items = await this.schedulingService.getSesetData(eventId);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 40 });
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc.fontSize(16).text('Cheat Sheet Tim Seset — 1447H', { align: 'center' });
      doc.fontSize(9).text('Masjid Al Hijrah CGE', { align: 'center' });
      doc.moveDown();

      let isFirst = true;
      for (const it of items) {
        if (!it.animal.scheduledAt) continue;
        const estimatedHeight = 16 + Math.max(it.sohibulRequests.length, 1) * 60 + 16;
        const remainingSpace = doc.page.height - doc.y - 30;
        if (!isFirst && remainingSpace < estimatedHeight) {
          doc.addPage();
        }
        isFirst = false;

        const time = fmtTime(new Date(it.animal.scheduledAt));
        const team = it.animal.scheduledTeam === 'SAPI' ? 'SAPI' : 'KAMBING/DOMBA';

        doc
          .fontSize(12)
          .fillColor('#000')
          .text(
            `${time} • Tim ${team} • ${it.animal.animalCode} (${it.animal.animalType})`,
            { underline: true },
          );
        doc.moveDown(0.3);

        if (it.sohibulRequests.length === 0) {
          doc.fontSize(10).fillColor('#888').text('(vendor — tidak ada permintaan)');
          doc.moveDown();
          continue;
        }

        for (const s of it.sohibulRequests) {
          doc.fontSize(11).fillColor('#000').text(`Sohibul: ${s.name}`);
          doc.fontSize(9).fillColor('#444');
          doc.text(`  Hak: ${s.hak || '—'}`);
          doc.text(`  Permintaan khusus: ${s.permintaanKhusus || '—'}`);
          doc.text(`  Catatan pengambilan: ${s.catatanSebagian || '—'}`);
          doc.text(`  Catatan untuk panitia: ${s.catatanPanitia || '—'}`);
          doc.moveDown(0.2);
        }

        doc.moveDown(0.5);
        doc.strokeColor('#ccc').moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
        doc.moveDown(0.5);
      }

      const now = new Date();
      doc.fontSize(7).fillColor('#888').text(
        `Generated ${now.toISOString()}`,
        40,
        doc.page.height - 30,
        { align: 'center', width: doc.page.width - 80 },
      );

      doc.end();
    });
  }
}
