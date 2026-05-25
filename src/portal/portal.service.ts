import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Menunggu Pembayaran',
  PENDING_VERIFICATION: 'Menunggu Verifikasi Panitia',
  CONFIRMED: 'Terkonfirmasi ✅',
  REJECTED: 'Ditolak',
};

const ANIMAL_LABELS: Record<string, string> = {
  DOMBA: 'Domba',
  KAMBING: 'Kambing',
  SAPI: 'Sapi',
  SAPI_KOLEKTIF: 'Sapi Kolektif',
  SAPI_KOLEKTIF_A: 'Sapi Kolektif A',
  SAPI_KOLEKTIF_B: 'Sapi Kolektif B',
  SAPI_KOLEKTIF_C: 'Sapi Kolektif C',
  SAPI_PERORANGAN: 'Sapi Perorangan',
};

@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Pengkurban)
    private pengkurbanRepository: Repository<Pengkurban>,
    @InjectRepository(FormResponse)
    private formResponseRepository: Repository<FormResponse>,
    private jwtService: JwtService,
  ) {}

  private normalizePhone(raw: string): { form1: string; form2: string } {
    const clean = raw.replace(/\D/g, '');
    let base = clean;
    if (base.startsWith('62')) base = '0' + base.slice(2);
    const form1 = base; // 08xxx
    const form2 = '62' + base.slice(1); // 628xxx
    return { form1, form2 };
  }

  async login(
    phone: string,
  ): Promise<{ token: string; pengkurban: Partial<Pengkurban> }> {
    const { form1, form2 } = this.normalizePhone(phone);

    const pengkurban = await this.pengkurbanRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.event', 'event')
      .where('p.phone = :form1 OR p.phone = :form2', { form1, form2 })
      .orderBy('p.created_at', 'DESC')
      .getOne();

    if (!pengkurban) {
      throw new NotFoundException(
        'Nomor WhatsApp tidak terdaftar sebagai pengkurban',
      );
    }

    const payload = {
      sub: pengkurban.id,
      type: 'sohibul',
      name: pengkurban.shohibulName || pengkurban.name,
    };

    const token = this.jwtService.sign(payload);

    return {
      token,
      pengkurban: {
        id: pengkurban.id,
        name: pengkurban.name,
        registrationNumber: pengkurban.registrationNumber,
        animalType: pengkurban.animalType,
        status: pengkurban.status,
      },
    };
  }

  async getProfile(pengkurbanId: string): Promise<any> {
    const p = await this.pengkurbanRepository.findOne({
      where: { id: pengkurbanId },
      relations: ['event'],
    });
    if (!p) throw new NotFoundException('Data pengkurban tidak ditemukan');

    return {
      id: p.id,
      name: p.name,
      shohibulName: p.shohibulName,
      registrationNumber: p.registrationNumber,
      animalType: p.animalType,
      animalLabel: ANIMAL_LABELS[p.animalType] || p.animalType,
      purchaseType: p.purchaseType,
      status: p.status,
      statusLabel: STATUS_LABELS[p.status] || p.status,
      phone: p.phone,
      createdAt: p.createdAt,
      event: p.event
        ? { id: p.event.id, name: p.event.name, year: p.event.year }
        : null,
    };
  }

  async getFormResponse(pengkurbanId: string): Promise<any[]> {
    const p = await this.pengkurbanRepository.findOne({
      where: { id: pengkurbanId },
      select: ['registrationNumber'],
    });
    if (!p) return [];

    const responses = await this.formResponseRepository.find({
      where: { pengkurbanId },
      order: { formSubmittedAt: 'DESC' },
    });
    return responses.map((r) => ({
      formKey: r.formKey,
      data: r.data,
      submittedAt: r.formSubmittedAt,
    }));
  }

  async generateReportPdf(pengkurbanId: string): Promise<Buffer> {
    const profile = await this.getProfile(pengkurbanId);
    const formResponses = await this.getFormResponse(pengkurbanId);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const PAGE_W = 495; // 595 - 2*50 margin

      // ─── Header ───
      doc.rect(0, 0, 595, 80).fill('#064e3b');
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
      doc.text('KARTU SOHIBUL QURBAN', 50, 22, {
        width: PAGE_W,
        align: 'center',
      });
      doc.font('Helvetica').fontSize(11).fillColor('#6ee7b7');
      doc.text('Masjid Al Hijrah CGE', 50, 48, {
        width: PAGE_W,
        align: 'center',
      });

      let y = 105;

      // ─── Registration Number ───
      doc.roundedRect(50, y, PAGE_W, 40, 6).fillAndStroke('#f0fdf4', '#86efac');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#166534');
      doc.text('Nomor Registrasi', 66, y + 6, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#064e3b');
      doc.text(profile.registrationNumber, 66, y + 20, { lineBreak: false });
      y += 56;

      // ─── Personal Info ───
      const infoFields = [
        ['Nama Sohibul', profile.shohibulName || profile.name],
        ['Nama Pendaftar', profile.name],
        ['Jenis Hewan', profile.animalLabel],
        ['Status Registrasi', profile.statusLabel],
        ['Event', profile.event?.name || '-'],
        ['Tahun', profile.event?.year || '-'],
      ];

      // Compute row heights up-front (multiline values wrap properly)
      const LABEL_X = 66;
      const VALUE_X = 210;
      const VALUE_W = PAGE_W - (VALUE_X - 50) - 16;
      const ROW_PAD = 6;
      const rowHeights: number[] = infoFields.map(([, value]) => {
        doc.font('Helvetica-Bold').fontSize(9);
        const h = doc.heightOfString(String(value || '-'), { width: VALUE_W });
        return Math.max(h, 12) + ROW_PAD;
      });
      const boxH =
        12 + rowHeights.reduce((a, b) => a + b, 0) + 10;

      doc.roundedRect(50, y, PAGE_W, boxH, 6).fillAndStroke('#1e3a2f', '#10b981');
      y += 12;

      infoFields.forEach(([label, value], i) => {
        doc.font('Helvetica').fontSize(9).fillColor('#6ee7b7');
        doc.text(label + ':', LABEL_X, y, { lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
        doc.text(String(value || '-'), VALUE_X, y, { width: VALUE_W });
        y += rowHeights[i];
      });
      y += 20;

      // ─── Form Responses ───
      const FR_LABEL_X = 66;
      const FR_VALUE_X = 240;
      const FR_VALUE_W = PAGE_W - (FR_VALUE_X - 50) - 16;
      const FR_ROW_PAD = 4;
      const PAGE_BOTTOM = doc.page.height - 60;

      const ensureSpace = (needed: number) => {
        if (y + needed > PAGE_BOTTOM) {
          doc.addPage();
          y = 50;
        }
      };

      if (formResponses.length > 0) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#10b981');
        doc.text('Konfirmasi Teknis', 50, y);
        y += 18;

        for (const resp of formResponses) {
          const submittedDate = new Date(resp.submittedAt).toLocaleDateString(
            'id-ID',
            { day: 'numeric', month: 'long', year: 'numeric' },
          );
          ensureSpace(20);
          doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
          doc.text(`Disubmit: ${submittedDate}`, 50, y);
          y += 14;

          const data = resp.data as Record<string, string>;
          const entries = Object.entries(data);

          for (const [key, val] of entries) {
            doc.font('Helvetica').fontSize(8);
            const valStr = String(val || '-');
            const valH = doc.heightOfString(valStr, { width: FR_VALUE_W });
            const rowH = Math.max(valH, 10) + FR_ROW_PAD;
            ensureSpace(rowH + 4);

            doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
            doc.text(key + ':', FR_LABEL_X, y, {
              width: FR_VALUE_X - FR_LABEL_X - 8,
            });
            doc.font('Helvetica').fontSize(8).fillColor('#d1fae5');
            doc.text(valStr, FR_VALUE_X, y, { width: FR_VALUE_W });
            const keyH = doc.heightOfString(key + ':', {
              width: FR_VALUE_X - FR_LABEL_X - 8,
            });
            y += Math.max(valH, keyH, 10) + FR_ROW_PAD;
          }
          y += 8;
        }
      } else {
        doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
        doc.text(
          'Belum ada data konfirmasi teknis (form belum diisi).',
          50,
          y,
        );
        y += 20;
      }

      // ─── Footer ───
      doc.fontSize(8).fillColor('#6b7280');
      doc.text(
        `Laporan digenerate otomatis oleh sistem panitia kurban pada ${new Date().toLocaleString('id-ID')}.`,
        50,
        doc.page.height - 50,
        { width: PAGE_W, align: 'center' },
      );

      doc.end();
    });
  }
}
