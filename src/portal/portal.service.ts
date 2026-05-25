import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { PortalOtp } from './portal-otp.entity';
import { Animal } from '../animals/animal.entity';
import { WaNotifierService } from '../common/notifications/wa-notifier.service';

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

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MIN_INTERVAL_MS = 60 * 1000; // 1 min between requests per phone
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    @InjectRepository(Pengkurban)
    private pengkurbanRepository: Repository<Pengkurban>,
    @InjectRepository(FormResponse)
    private formResponseRepository: Repository<FormResponse>,
    @InjectRepository(PortalOtp)
    private otpRepository: Repository<PortalOtp>,
    @InjectRepository(Animal)
    private animalRepository: Repository<Animal>,
    private jwtService: JwtService,
    private waNotifier: WaNotifierService,
  ) {}

  private normalizePhone(raw: string): { form1: string; form2: string } {
    const clean = raw.replace(/\D/g, '');
    let base = clean;
    if (base.startsWith('62')) base = '0' + base.slice(2);
    if (!base.startsWith('0')) base = '0' + base;
    const form1 = base; // 08xxx
    const form2 = '62' + base.slice(1); // 628xxx
    return { form1, form2 };
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private async findPengkurbanByPhone(
    phone: string,
  ): Promise<Pengkurban | null> {
    const { form1, form2 } = this.normalizePhone(phone);
    return this.pengkurbanRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.event', 'event')
      .where('p.phone = :form1 OR p.phone = :form2', { form1, form2 })
      .orderBy('p.created_at', 'DESC')
      .getOne();
  }

  async requestOtp(phone: string): Promise<{ message: string }> {
    const pengkurban = await this.findPengkurbanByPhone(phone);
    if (!pengkurban) {
      throw new NotFoundException(
        'Nomor WhatsApp tidak terdaftar sebagai pengkurban',
      );
    }

    const { form1, form2 } = this.normalizePhone(phone);

    // Rate-limit: max 1 OTP request per phone per OTP_MIN_INTERVAL_MS
    const recent = await this.otpRepository.findOne({
      where: {
        phone: form1,
        createdAt: MoreThan(new Date(Date.now() - OTP_MIN_INTERVAL_MS)),
      },
      order: { createdAt: 'DESC' },
    });
    if (recent) {
      const waitSec = Math.ceil(
        (recent.createdAt.getTime() + OTP_MIN_INTERVAL_MS - Date.now()) / 1000,
      );
      throw new BadRequestException(
        `Terlalu cepat. Coba lagi dalam ${waitSec} detik.`,
      );
    }

    // Invalidate any prior unused codes for this phone
    await this.otpRepository.delete({ phone: form1 });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.otpRepository.save({
      phone: form1,
      codeHash: this.hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
    });

    const message =
      `🔐 Kode login Portal Sohibul Qurban Masjid Al Hijrah CGE\n\n` +
      `Kode Anda: *${code}*\n\n` +
      `Berlaku 5 menit. Jangan bagikan kode ini ke siapa pun.\n` +
      `Jika bukan Anda yang meminta, abaikan pesan ini.`;
    // Fire-and-forget: don't block response on wa-bot delivery.
    // wa-bot requires international format (628xxx), not local (08xxx).
    this.waNotifier.sendTo(form2, message).then((sent) => {
      if (!sent) {
        this.logger.warn(
          `[portal.requestOtp] WA send failed for ${form2}, OTP still issued`,
        );
      }
    });

    return {
      message: `Kode OTP dikirim ke WhatsApp ${form1.replace(/(\d{4})\d+(\d{3})/, '$1***$2')}`,
    };
  }

  async verifyOtp(
    phone: string,
    code: string,
  ): Promise<{ token: string; pengkurban: Partial<Pengkurban> }> {
    const { form1 } = this.normalizePhone(phone);

    const otp = await this.otpRepository.findOne({
      where: { phone: form1 },
      order: { createdAt: 'DESC' },
    });
    if (!otp) {
      throw new UnauthorizedException('Kode OTP tidak ditemukan');
    }
    if (otp.expiresAt < new Date()) {
      await this.otpRepository.delete({ id: otp.id });
      throw new UnauthorizedException('Kode OTP sudah kedaluwarsa');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await this.otpRepository.delete({ id: otp.id });
      throw new UnauthorizedException(
        'Terlalu banyak percobaan. Silakan minta OTP baru.',
      );
    }

    if (otp.codeHash !== this.hashCode(code)) {
      await this.otpRepository.increment({ id: otp.id }, 'attempts', 1);
      const remaining = OTP_MAX_ATTEMPTS - (otp.attempts + 1);
      throw new UnauthorizedException(
        `Kode OTP salah. Sisa percobaan: ${Math.max(remaining, 0)}`,
      );
    }

    // Success — delete code
    await this.otpRepository.delete({ id: otp.id });

    const pengkurban = await this.findPengkurbanByPhone(phone);
    if (!pengkurban) {
      throw new NotFoundException('Pengkurban tidak ditemukan');
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

  // Housekeeping: caller can wire this to a cron if desired
  async cleanupExpiredOtp(): Promise<void> {
    await this.otpRepository.delete({ expiresAt: LessThan(new Date()) });
  }

  async updateShohibulName(
    pengkurbanId: string,
    shohibulName: string,
  ): Promise<{ shohibulName: string }> {
    const trimmed = shohibulName.trim();
    if (!trimmed) {
      throw new BadRequestException('Nama sohibul tidak boleh kosong');
    }
    if (trimmed.length > 2000) {
      throw new BadRequestException('Nama sohibul terlalu panjang');
    }
    const p = await this.pengkurbanRepository.findOne({
      where: { id: pengkurbanId },
    });
    if (!p) throw new NotFoundException('Pengkurban tidak ditemukan');
    p.shohibulName = trimmed;
    await this.pengkurbanRepository.save(p);
    return { shohibulName: trimmed };
  }

  async getAnimalsForSohibul(pengkurbanId: string): Promise<any[]> {
    const p = await this.pengkurbanRepository.findOne({
      where: { id: pengkurbanId },
    });
    if (!p) return [];

    const KOLEKTIF_TYPES = new Set([
      'SAPI_KOLEKTIF',
      'SAPI_KOLEKTIF_A',
      'SAPI_KOLEKTIF_B',
      'SAPI_KOLEKTIF_C',
    ]);

    let animals: Animal[];
    if (KOLEKTIF_TYPES.has(p.animalType)) {
      animals = await this.animalRepository.find({
        where: { animalType: p.animalType, eventId: p.eventId },
        order: { animalCode: 'ASC' },
      });
    } else {
      animals = await this.animalRepository.find({
        where: { pengkurbanId: p.id },
        order: { animalCode: 'ASC' },
      });
    }

    return animals.map((a) => ({
      animalCode: a.animalCode,
      animalType: a.animalType,
      status: a.status,
      receivedAt: a.receivedAt,
      photos: a.photos || [],
      isVendorAnimal: a.isVendorAnimal,
    }));
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
