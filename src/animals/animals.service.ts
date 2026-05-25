import {
  Injectable,
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
  constructor(
    @InjectRepository(Animal)
    private animalsRepository: Repository<Animal>,
    @InjectRepository(Event)
    private eventsRepository: Repository<Event>,
    @InjectRepository(Pengkurban)
    private pengkurbanRepository: Repository<Pengkurban>,
  ) {}

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

    if (KOLEKTIF_TYPES.includes(animal.animalType)) {
      // Query all pengkurban of this type for this event
      const list = await this.pengkurbanRepository.find({
        where: { eventId: animal.eventId, animalType: animal.animalType as any },
        select: ['id', 'name', 'shohibulName'],
      });
      return list.map((p) => p.shohibulName || p.name);
    }

    if (animal.pengkurbanId) {
      const p = await this.pengkurbanRepository.findOne({
        where: { id: animal.pengkurbanId },
        select: ['id', 'name', 'shohibulName'],
      });
      if (p) return [p.shohibulName || p.name];
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

    // 1. Kolektif types: one animal per type (if not already exists)
    for (const kolektifType of KOLEKTIF_TYPES) {
      const count = await this.pengkurbanRepository.count({
        where: { eventId, animalType: kolektifType as any },
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

    // 2. Individual types: one animal per pengkurban (CONFIRMED status)
    const confirmed = await this.pengkurbanRepository.find({
      where: [
        { eventId, animalType: 'DOMBA' as any },
        { eventId, animalType: 'KAMBING' as any },
        { eventId, animalType: 'SAPI_PERORANGAN' as any },
        { eventId, animalType: 'SAPI_KOLEKTIF' as any },
        { eventId, animalType: 'SAPI' as any },
      ],
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
    animal.photos = [...current, filename];
    const saved = await this.animalsRepository.save(animal);
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
        const QR_PANEL_W = 160; // diperlebar dari 120 supaya QR 140pt muat
        const QR_X = PADDING + CARD_W - QR_PANEL_W;

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

        // Header
        const headerY = cardY + 18;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#10b981');
        t('KARTU HEWAN QURBAN', L, headerY);
        doc.font('Helvetica').fontSize(8).fillColor('#6b7280');
        t('Masjid Al Hijrah CGE', L, headerY + 13);

        // Animal code (font diperbesar 11→18)
        const codeY = cardY + 50;
        doc.roundedRect(L, codeY, 240, 32, 5).fillAndStroke('#f0fdf4', '#86efac');
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#166534');
        t(a.animalCode, L, codeY + 8, { width: 240, align: 'center' });

        // Animal type label (font diperbesar 14→22)
        const typeY = codeY + 42;
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#1f2937');
        t(a.animalLabel, L, typeY);

        // Sohibul names (status badge dihilangkan — PDF dicetak fisik, status ga relevan di kertas)
        const namesY = typeY + 32;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#6b7280');
        t('SOHIBUL QURBAN:', L, namesY);
        const names: string[] = a.sohibulNames || [];
        const NAMES_W = QR_X - L - 8; // available width before QR panel
        const NAMES_MAX_Y = cardY + CARD_H - 28; // leave room for received-info footer
        if (names.length === 0) {
          doc.font('Helvetica').fontSize(11).fillColor('#9ca3af');
          t('(Hewan Vendor — tidak terdaftar)', L, namesY + 14);
        } else {
          doc.font('Helvetica').fontSize(11).fillColor('#1f2937');
          let cursorY = namesY + 14;
          const toRender = names.slice(0, 7);
          for (let idx = 0; idx < toRender.length; idx++) {
            if (cursorY >= NAMES_MAX_Y) {
              const remaining = toRender.length - idx;
              doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280');
              doc.text(`+${remaining} lainnya`, L, cursorY, { width: NAMES_W, lineBreak: false });
              break;
            }
            doc.text(`${idx + 1}. ${toRender[idx]}`, L, cursorY, {
              width: NAMES_W,
              lineGap: 2,
            });
            cursorY = doc.y + 2;
            doc.font('Helvetica').fontSize(11).fillColor('#1f2937'); // reset after potential overflow font switch
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

        // QR code panel (QR diperbesar 80→140, panel diperlebar)
        doc.roundedRect(QR_X, cardY + 10, QR_PANEL_W, CARD_H - 20, 6).fill('#ecfdf5');

        const qrDataUrl = qrMap[a.id];
        if (qrDataUrl && qrDataUrl.includes(',')) {
          try {
            const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
            const QR_SIZE = Math.min(QR_PANEL_W - 16, 140);
            const qrX = QR_X + (QR_PANEL_W - QR_SIZE) / 2;
            const qrY = cardY + 10 + (CARD_H - 20 - QR_SIZE - 24) / 2;
            doc.image(qrBuffer, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#10b981');
            t('SCAN KARTU HEWAN', QR_X, qrY + QR_SIZE + 8, {
              width: QR_PANEL_W,
              align: 'center',
            });
          } catch {
            /* skip */
          }
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
