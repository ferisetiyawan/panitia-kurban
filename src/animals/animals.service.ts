import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as QRCode from 'qrcode';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as path from 'path';
import { Animal } from './animal.entity';
import { Event } from '../events/event.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { WaNotifierService } from '../common/notifications/wa-notifier.service';

const KOLEKTIF_TYPES = [
  'SAPI_KOLEKTIF_A',
  'SAPI_KOLEKTIF_B',
  'SAPI_KOLEKTIF_C',
];

const INDIVIDUAL_TYPES = ['DOMBA', 'KAMBING', 'SAPI_PERORANGAN', 'SAPI_KOLEKTIF'];

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
export class AnimalsService {
  private readonly logger = new Logger(AnimalsService.name);

  constructor(
    @InjectRepository(Animal)
    private animalsRepository: Repository<Animal>,
    @InjectRepository(Event)
    private eventsRepository: Repository<Event>,
    @InjectRepository(Pengkurban)
    private pengkurbanRepository: Repository<Pengkurban>,
    private waNotifier: WaNotifierService,
  ) {}

  /**
   * Return all pengkurban linked to an animal (with phone normalized).
   * For individual animals: 1 pengkurban via pengkurban_id.
   * For kolektif: all pengkurban with same animal_type + event_id.
   */
  private async getPengkurbanForAnimal(
    animal: Animal,
  ): Promise<Pengkurban[]> {
    if (animal.isVendorAnimal) return [];
    if (KOLEKTIF_TYPES.includes(animal.animalType)) {
      // Kolektif: include pengkurban yg CONFIRMED atau PENDING_VERIFICATION
      // (sudah upload bukti, tinggal verify). PENDING_PAYMENT & REJECTED di-skip.
      return this.pengkurbanRepository.find({
        where: {
          eventId: animal.eventId,
          animalType: animal.animalType as any,
          status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
        },
        select: ['id', 'name', 'shohibulName', 'phone'],
      });
    }
    if (animal.pengkurbanId) {
      const p = await this.pengkurbanRepository.findOne({
        where: { id: animal.pengkurbanId },
        select: ['id', 'name', 'shohibulName', 'phone', 'status'],
      });
      // Skip REJECTED/PENDING_PAYMENT — kartu/notif buat status itu ga relevan
      if (!p) return [];
      const status = (p as any).status;
      if (status === 'REJECTED' || status === 'PENDING_PAYMENT') return [];
      return [p];
    }
    return [];
  }

  private normalizePhoneToInternational(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const clean = raw.replace(/\D/g, '');
    if (!clean) return null;
    let base = clean;
    if (base.startsWith('62')) return base; // already 628xxx
    if (base.startsWith('0')) return '62' + base.slice(1);
    return '62' + base;
  }

  /** Fire-and-forget WA notif ke semua sohibul yg terkait sebuah hewan. */
  private async notifySohibulOnAnimal(
    animal: Animal,
    message: string,
  ): Promise<void> {
    const pengkurbans = await this.getPengkurbanForAnimal(animal);
    const sent = new Set<string>();
    for (const p of pengkurbans) {
      const phone = this.normalizePhoneToInternational(p.phone);
      if (!phone) {
        this.logger.warn(
          `[animals.notify] skip ${p.id} (${p.name}) — no phone`,
        );
        continue;
      }
      if (sent.has(phone)) continue; // dedup kalau 1 phone untuk beberapa reg
      sent.add(phone);
      this.waNotifier.sendTo(phone, message).then((ok) => {
        if (!ok) {
          this.logger.warn(`[animals.notify] WA fail to ${phone}`);
        }
      });
    }
  }

  private generateAnimalCode(): string {
    // Get hijri year from today
    const hijriFormatter = new Intl.DateTimeFormat('en-US-u-ca-islamic', {
      year: 'numeric',
    });
    const hijriYearRaw = hijriFormatter.format(new Date());
    const hijriYear = hijriYearRaw.split(' ')[0];

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const random = Array.from({ length: 8 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length)),
    ).join('');
    return `ANM-${hijriYear}H-${random}`;
  }

  private async generateUniqueCode(): Promise<string> {
    let code = '';
    let isUnique = false;
    while (!isUnique) {
      code = this.generateAnimalCode();
      const existing = await this.animalsRepository.findOne({
        where: { animalCode: code },
      });
      if (!existing) isUnique = true;
    }
    return code;
  }

  private getAnimalLabel(animalType: string): string {
    return ANIMAL_LABELS[animalType] || animalType;
  }

  private async getSohibulNames(animal: Animal): Promise<string[]> {
    if (animal.isVendorAnimal) return [];

    // Flatten: shohibul_name bisa multi-baris (1 pengkurban listing 7 nama
    // dalam 1 row). Split per newline biar render PDF / UI bisa nomori
    // per nama individu.
    const splitNames = (s: string): string[] =>
      s.split('\n').map((n) => n.trim()).filter(Boolean);

    if (KOLEKTIF_TYPES.includes(animal.animalType)) {
      const list = await this.pengkurbanRepository.find({
        where: {
          eventId: animal.eventId,
          animalType: animal.animalType as any,
          status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
        },
        select: ['id', 'name', 'shohibulName'],
      });
      return list.flatMap((p) => splitNames(p.shohibulName || p.name));
    }

    if (animal.pengkurbanId) {
      const p = await this.pengkurbanRepository.findOne({
        where: { id: animal.pengkurbanId },
        select: ['id', 'name', 'shohibulName', 'status'],
      });
      // Skip REJECTED/PENDING_PAYMENT
      if (!p) return [];
      const status = (p as any).status;
      if (status === 'REJECTED' || status === 'PENDING_PAYMENT') return [];
      return splitNames(p.shohibulName || p.name);
    }

    return [];
  }

  async findAll(
    eventId?: string,
    animalType?: string,
    status?: string,
  ): Promise<any[]> {
    const where: any = {};
    if (eventId) where.eventId = eventId;
    if (animalType) where.animalType = animalType;
    if (status) where.status = status;

    const animals = await this.animalsRepository.find({
      where,
      relations: ['event'],
      order: { animalType: 'ASC', animalCode: 'ASC' },
    });

    return Promise.all(
      animals.map(async (a) => ({
        ...a,
        sohibulNames: await this.getSohibulNames(a),
        animalLabel: this.getAnimalLabel(a.animalType),
      })),
    );
  }

  async findById(id: string): Promise<any> {
    const animal = await this.animalsRepository.findOne({
      where: { id },
      relations: ['event'],
    });
    if (!animal) throw new NotFoundException('Hewan tidak ditemukan');
    return {
      ...animal,
      sohibulNames: await this.getSohibulNames(animal),
      animalLabel: this.getAnimalLabel(animal.animalType),
    };
  }

  async findByCode(animalCode: string): Promise<any> {
    const animal = await this.animalsRepository.findOne({
      where: { animalCode },
      relations: ['event'],
    });
    if (!animal) throw new NotFoundException('Hewan tidak ditemukan');
    return {
      ...animal,
      sohibulNames: await this.getSohibulNames(animal),
      animalLabel: this.getAnimalLabel(animal.animalType),
    };
  }

  async generateFromRegistrations(
    eventId: string,
  ): Promise<{ created: number; message: string }> {
    const event = await this.eventsRepository.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event tidak ditemukan');

    let created = 0;
    // CONFIRMED + PENDING_VERIFICATION dianggap eligible — sudah upload bukti,
    // tinggal verify panitia. REJECTED dan PENDING_PAYMENT di-skip.
    const ELIGIBLE_STATUSES = ['CONFIRMED', 'PENDING_VERIFICATION'];

    // 1. Kolektif types: one animal per type (kalau ada minimal 1 pengkurban eligible)
    for (const kolektifType of KOLEKTIF_TYPES) {
      const count = await this.pengkurbanRepository.count({
        where: {
          eventId,
          animalType: kolektifType as any,
          status: In(ELIGIBLE_STATUSES) as any,
        },
      });
      if (count === 0) continue;

      const existing = await this.animalsRepository.findOne({
        where: { eventId, animalType: kolektifType, isVendorAnimal: false },
      });
      if (existing) continue;

      const animalCode = await this.generateUniqueCode();
      await this.animalsRepository.save(
        this.animalsRepository.create({
          animalCode,
          animalType: kolektifType,
          eventId,
          isVendorAnimal: false,
          status: 'PENDING',
          photos: null,
        }),
      );
      created++;
    }

    // 2. Individual types: one animal per eligible pengkurban
    const individualTypes = ['DOMBA', 'KAMBING', 'SAPI_PERORANGAN', 'SAPI_KOLEKTIF', 'SAPI'];
    const confirmed = await this.pengkurbanRepository.find({
      where: individualTypes.flatMap((animalType) =>
        ELIGIBLE_STATUSES.map((status) => ({
          eventId,
          animalType: animalType as any,
          status: status as any,
        })),
      ),
      withDeleted: false,
    });

    for (const pk of confirmed) {
      const existing = await this.animalsRepository.findOne({
        where: { pengkurbanId: pk.id },
      });
      if (existing) continue;

      const animalCode = await this.generateUniqueCode();
      await this.animalsRepository.save(
        this.animalsRepository.create({
          animalCode,
          animalType: pk.animalType,
          eventId,
          pengkurbanId: pk.id,
          isVendorAnimal: false,
          status: 'PENDING',
          photos: null,
        }),
      );
      created++;
    }

    return {
      created,
      message: `${created} kartu hewan berhasil dibuat`,
    };
  }

  async createVendorAnimal(
    eventId: string,
    animalType: string,
    notes?: string,
  ): Promise<Animal> {
    const event = await this.eventsRepository.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event tidak ditemukan');

    const validTypes = [...KOLEKTIF_TYPES, ...INDIVIDUAL_TYPES];
    if (!validTypes.includes(animalType)) {
      throw new BadRequestException(`animalType tidak valid: ${animalType}`);
    }

    const animalCode = await this.generateUniqueCode();
    return this.animalsRepository.save(
      this.animalsRepository.create({
        animalCode,
        animalType,
        eventId,
        isVendorAnimal: true,
        status: 'PENDING',
        notes: notes || null,
        photos: null,
      }),
    );
  }

  async receive(
    id: string,
    userId: string,
    notes?: string,
  ): Promise<any> {
    const animal = await this.animalsRepository.findOne({ where: { id } });
    if (!animal) throw new NotFoundException('Hewan tidak ditemukan');

    if (animal.status === 'RECEIVED') {
      throw new BadRequestException('Hewan sudah tercatat diterima');
    }

    animal.status = 'RECEIVED';
    animal.receivedAt = new Date();
    animal.receivedById = userId;
    if (notes) animal.notes = notes;

    const saved = await this.animalsRepository.save(animal);

    const label = this.getAnimalLabel(saved.animalType);
    const msg =
      `🐄 *Hewan Qurban Anda Diterima Panitia*\n\n` +
      `${label} dengan kode *${saved.animalCode}* sudah tercatat diterima oleh panitia kurban Masjid Al Hijrah CGE.\n\n` +
      `Anda bisa cek detail dan foto hewan (kalau ada) di portal sohibul:\n` +
      `https://kurban.masjidalhijrahcge.id/portal.html\n\n` +
      `Login pakai nomor WA ini, kami kirim kode OTP.\n\n` +
      `_Pesan otomatis sistem panitia kurban._`;
    this.notifySohibulOnAnimal(saved, msg).catch((e) =>
      this.logger.error(`[animals.receive notif] ${e?.message || e}`),
    );

    return {
      ...saved,
      sohibulNames: await this.getSohibulNames(saved),
      animalLabel: this.getAnimalLabel(saved.animalType),
      message: 'Hewan berhasil dicatat sebagai diterima',
    };
  }

  async addPhoto(id: string, filename: string): Promise<any> {
    const animal = await this.animalsRepository.findOne({ where: { id } });
    if (!animal) throw new NotFoundException('Hewan tidak ditemukan');

    const current = animal.photos || [];
    const isFirstPhoto = current.length === 0;
    animal.photos = [...current, filename];
    const saved = await this.animalsRepository.save(animal);

    // Hanya notif WA saat foto PERTAMA ditambah — untuk tiap upload foto berikutnya
    // jangan spam. Sohibul bisa lihat semua foto via portal.
    if (isFirstPhoto) {
      const label = this.getAnimalLabel(saved.animalType);
      const msg =
        `📸 *Foto Hewan Qurban Anda Tersedia*\n\n` +
        `${label} dengan kode *${saved.animalCode}* sekarang ada fotonya — bisa dilihat di portal sohibul.\n\n` +
        `https://kurban.masjidalhijrahcge.id/portal.html\n\n` +
        `Login pakai nomor WA ini, kami kirim kode OTP.\n\n` +
        `_Pesan otomatis sistem panitia kurban._`;
      this.notifySohibulOnAnimal(saved, msg).catch((e) =>
        this.logger.error(`[animals.addPhoto notif] ${e?.message || e}`),
      );
    }

    return {
      ...saved,
      sohibulNames: await this.getSohibulNames(saved),
      animalLabel: this.getAnimalLabel(saved.animalType),
    };
  }

  async remove(id: string): Promise<void> {
    const animal = await this.animalsRepository.findOne({ where: { id } });
    if (!animal) throw new NotFoundException('Hewan tidak ditemukan');
    await this.animalsRepository.remove(animal);
  }

  async generateCardPdf(ids?: string[], eventId?: string): Promise<Buffer> {
    let animalsWithNames: any[];

    if (ids && ids.length > 0) {
      const animals = await this.animalsRepository.find({
        where: { id: In(ids) },
        relations: ['event'],
        order: { animalType: 'ASC', animalCode: 'ASC' },
      });
      animalsWithNames = await Promise.all(
        animals.map(async (a) => ({
          ...a,
          sohibulNames: await this.getSohibulNames(a),
          animalLabel: this.getAnimalLabel(a.animalType),
        })),
      );
    } else if (eventId) {
      animalsWithNames = await this.findAll(eventId);
    } else {
      throw new BadRequestException('ids atau eventId harus diisi');
    }

    if (animalsWithNames.length === 0) {
      throw new NotFoundException('Tidak ada kartu hewan untuk digenerate');
    }

    return this.buildPdf(animalsWithNames);
  }

  private async buildPdf(animals: any[]): Promise<Buffer> {
    // Pre-generate QR codes
    const qrMap: Record<string, string> = {};
    for (const a of animals) {
      qrMap[a.id] = await QRCode.toDataURL(a.animalCode, {
        width: 200,
        margin: 1,
      });
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        autoFirstPage: false,
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // A4 portrait: 595.28 x 841.89 pts
      // 2 cards per page with some padding
      const PAGE_W = 595.28;
      const PAGE_H = 841.89;
      const PADDING = 20;
      const CARD_GAP = 10;
      const CARD_W = PAGE_W - 2 * PADDING;
      const CARD_H = (PAGE_H - 2 * PADDING - CARD_GAP) / 2;

      const t = (text: string, x: number, y: number, opts: any = {}) => {
        doc.text(text, x, y, { ...opts, lineBreak: false });
      };

      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        const slot = i % 2;

        if (slot === 0) {
          doc.addPage({ size: 'A4', margin: 0 });
        }

        const cardY =
          PADDING + slot * (CARD_H + CARD_GAP);
        const L = PADDING + 16;
        const R = PADDING + CARD_W - 16; // right edge inside card
        // QR top-right, smaller dari sebelumnya supaya names dapat full width
        const QR_SIZE = 110;
        const QR_X = R - QR_SIZE;
        const QR_Y = cardY + 16;

        // Card background
        doc.save();
        doc
          .roundedRect(PADDING, cardY, CARD_W, CARD_H, 8)
          .fillAndStroke('#ffffff', '#d1d5db');
        doc.restore();

        // Top color bar
        doc.save();
        doc.roundedRect(PADDING, cardY, CARD_W, CARD_H, 8).clip();
        doc.rect(PADDING, cardY, CARD_W, 5).fill('#10b981');
        doc.restore();

        // Left accent
        doc.save();
        doc.roundedRect(PADDING, cardY, CARD_W, CARD_H, 8).clip();
        doc.rect(PADDING, cardY + 5, 4, CARD_H - 5).fill('#10b981');
        doc.restore();

        // QR code top-right — smaller, no background panel (cleaner)
        const qrDataUrl = qrMap[a.id];
        if (qrDataUrl && qrDataUrl.includes(',')) {
          try {
            const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
            doc.image(qrBuffer, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE });
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#10b981');
            t('SCAN KARTU HEWAN', QR_X, QR_Y + QR_SIZE + 4, {
              width: QR_SIZE,
              align: 'center',
            });
          } catch {
            /* skip */
          }
        }

        // Header (kiri, narrow supaya ga overlap QR)
        const headerY = cardY + 18;
        const HEADER_W = QR_X - L - 12;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#10b981');
        t('KARTU HEWAN QURBAN', L, headerY, { width: HEADER_W });
        doc.font('Helvetica').fontSize(8).fillColor('#6b7280');
        t('Panitia Qurban 1447 H CGE', L, headerY + 13, { width: HEADER_W });

        // Animal code (kiri, masih di atas — ga overlap QR karena code box 240 < HEADER_W)
        const codeY = cardY + 50;
        doc.roundedRect(L, codeY, 240, 32, 5).fillAndStroke('#f0fdf4', '#86efac');
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#166534');
        t(a.animalCode, L, codeY + 8, { width: 240, align: 'center' });

        // Animal type label
        const typeY = codeY + 42;
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#6b7280');
        t(a.animalLabel, L, typeY);

        // Sohibul names — sekarang dapat full card width (QR udah di atas)
        // QR area ditelan dari bawah QR Y + label "SCAN..." selesai sekitar QR_Y + 130
        const QR_BOTTOM = QR_Y + QR_SIZE + 14;
        // Names start setelah animal label (atau setelah QR area, pilih yg lebih bawah)
        const namesHeaderY = Math.max(typeY + 24, QR_BOTTOM);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#6b7280');
        t('SOHIBUL QURBAN:', L, namesHeaderY);
        const names: string[] = a.sohibulNames || [];
        const NAMES_W = R - L; // full width!
        const NAMES_MAX_Y = cardY + CARD_H - 28;
        const NAME_FONT_SIZE = 18;
        const NAME_LINE_GAP = 4;
        if (names.length === 0) {
          doc.font('Helvetica').fontSize(NAME_FONT_SIZE).fillColor('#9ca3af');
          t('(Hewan Vendor — tidak terdaftar)', L, namesHeaderY + 18);
        } else {
          doc.font('Helvetica-Bold').fontSize(NAME_FONT_SIZE).fillColor('#1f2937');
          let cursorY = namesHeaderY + 18;
          const toRender = names.slice(0, 7);
          for (let idx = 0; idx < toRender.length; idx++) {
            if (cursorY >= NAMES_MAX_Y) {
              const remaining = toRender.length - idx;
              doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6b7280');
              doc.text(`+${remaining} lainnya`, L, cursorY, { width: NAMES_W, lineBreak: false });
              break;
            }
            doc.text(`${idx + 1}. ${toRender[idx]}`, L, cursorY, {
              width: NAMES_W,
              lineGap: NAME_LINE_GAP,
            });
            cursorY = doc.y + NAME_LINE_GAP;
            doc.font('Helvetica-Bold').fontSize(NAME_FONT_SIZE).fillColor('#1f2937');
          }
        }

        // Received info
        if (a.status === 'RECEIVED' && a.receivedAt) {
          const recvY = cardY + CARD_H - 22;
          const dateStr = new Date(a.receivedAt).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
          doc.font('Helvetica').fontSize(6.5).fillColor('#6b7280');
          t(`Diterima: ${dateStr}`, L, recvY);
        }

        // Separator line between cards on same page
        if (slot === 0 && i + 1 < animals.length) {
          doc
            .moveTo(PADDING + 20, cardY + CARD_H + CARD_GAP / 2)
            .lineTo(PAGE_W - PADDING - 20, cardY + CARD_H + CARD_GAP / 2)
            .lineWidth(0.5)
            .dash(4, { space: 4 })
            .stroke('#d1d5db');
          doc.undash();
        }
      }

      doc.end();
    });
  }
}
