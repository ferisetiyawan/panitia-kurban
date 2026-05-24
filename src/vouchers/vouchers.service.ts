import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as path from 'path';
import { Voucher } from './voucher.entity';
import { ScanLog } from './scan-log.entity';
import { Event } from '../events/event.entity';
import { VoucherStatus } from '../common/enums/voucher-status.enum';
import { VouchersGateway } from './vouchers.gateway';

@Injectable()
export class VouchersService {
  constructor(
    @InjectRepository(Voucher)
    private vouchersRepository: Repository<Voucher>,
    @InjectRepository(ScanLog)
    private scanLogsRepository: Repository<ScanLog>,
    @InjectRepository(Event)
    private eventsRepository: Repository<Event>,
    private vouchersGateway: VouchersGateway,
  ) {}

  async findAll(
    eventId?: string,
    status?: string,
    search?: string,
    distributionDate?: string,
    page?: number,
    limit?: number,
  ): Promise<any> {
    const qb = this.vouchersRepository
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.event', 'event')
      .leftJoinAndSelect('v.createdBy', 'creator')
      .leftJoinAndSelect('v.claimedBy', 'claimer')
      .orderBy('v.createdAt', 'DESC');

    if (eventId) {
      qb.andWhere('v.event_id = :eventId', { eventId });
    }
    if (status) {
      qb.andWhere('v.status = :status', { status });
    }
    if (search) {
      qb.andWhere('v.voucher_code ILIKE :search', { search: `%${search}%` });
    }
    if (distributionDate) {
      qb.andWhere('v.distribution_date = :distributionDate', {
        distributionDate,
      });
    }

    if (page && limit) {
      qb.skip((page - 1) * limit).take(limit);
      const [vouchers, total] = await qb.getManyAndCount();
      return {
        data: vouchers.map((v) => {
          if (v.createdBy) delete (v.createdBy as any).password;
          if (v.claimedBy) delete (v.claimedBy as any).password;
          return v;
        }),
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      };
    } else {
      const vouchers = await qb.getMany();
      return vouchers.map((v) => {
        if (v.createdBy) delete (v.createdBy as any).password;
        if (v.claimedBy) delete (v.claimedBy as any).password;
        return v;
      });
    }
  }

  async exportCsv(eventId?: string, status?: string): Promise<string> {
    const vouchers = (await this.findAll(eventId, status)) as Voucher[];
    const header = [
      'Kode Voucher',
      'Event',
      'Tahun',
      'Status',
      'Tgl Distribusi',
      'Dibuat Oleh',
      'Diklaim Oleh',
      'Tgl Klaim',
    ].join(',');
    const rows = vouchers.map((v: Voucher) => {
      return [
        v.voucherCode,
        v.event?.name || '',
        v.event?.year || '',
        v.status,
        v.distributionDate
          ? new Date(v.distributionDate).toISOString().split('T')[0]
          : '',
        v.createdBy?.fullName || '',
        v.claimedBy?.fullName || '',
        v.claimedAt ? new Date(v.claimedAt).toISOString() : '',
      ]
        .map((field) => `"${String(field).replace(/"/g, '""')}"`)
        .join(',');
    });
    return [header, ...rows].join('\n');
  }

  async findById(id: string): Promise<Voucher> {
    const voucher = await this.vouchersRepository.findOne({
      where: { id },
      relations: [
        'event',
        'createdBy',
        'claimedBy',
        'scanLogs',
        'scanLogs.scannedBy',
      ],
    });
    if (!voucher) throw new NotFoundException('Voucher tidak ditemukan');
    return voucher;
  }

  async findByCode(code: string): Promise<Voucher> {
    const voucher = await this.vouchersRepository.findOne({
      where: { voucherCode: code },
      relations: ['event', 'createdBy', 'claimedBy'],
    });
    if (!voucher) throw new NotFoundException('Voucher tidak ditemukan');
    return voucher;
  }

  async create(
    eventId: string,
    distributionDate: string,
    userId: string,
  ): Promise<Voucher> {
    const event = await this.eventsRepository.findOne({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Event tidak ditemukan');

    // Validate distribution date is within event date range
    this.validateDistributionDate(distributionDate, event);

    const voucherCode = await this.generateUniqueCode(
      distributionDate ? new Date(distributionDate) : new Date(),
    );
    const qrData = JSON.stringify({
      code: voucherCode,
      eventId,
      year: event.year,
    });
    const qrDataUrl = await QRCode.toDataURL(qrData, { width: 300, margin: 1 });

    const voucher = this.vouchersRepository.create({
      eventId,
      voucherCode,
      qrData: qrDataUrl,
      distributionDate: distributionDate
        ? new Date(distributionDate)
        : undefined,
      createdById: userId,
    });

    return this.vouchersRepository.save(voucher);
  }

  async createBatch(
    eventId: string,
    count: number,
    distributionDate: string,
    userId: string,
  ): Promise<Voucher[]> {
    const vouchers: Voucher[] = [];
    for (let i = 0; i < count; i++) {
      const voucher = await this.create(eventId, distributionDate, userId);
      vouchers.push(voucher);
    }
    return vouchers;
  }

  async scan(
    voucherCode: string,
    userId: string,
  ): Promise<{ voucher: Voucher; message: string }> {
    let voucher: Voucher;
    try {
      voucher = await this.findByCode(voucherCode);
    } catch {
      // Log failed scan - skip logging since no voucher found
      throw new NotFoundException('Voucher tidak ditemukan');
    }

    if (voucher.status === VoucherStatus.CLAIMED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah diklaim sebelumnya',
      });
      throw new BadRequestException('Voucher sudah diklaim sebelumnya');
    }

    if (voucher.status === VoucherStatus.CANCELLED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah dibatalkan',
      });
      throw new BadRequestException('Voucher sudah dibatalkan');
    }

    // Build pickup info before claiming (read fields before they're cleared)
    let pickupInfo: string | undefined;
    if (voucher.pickupCluster) {
      const dateStr = voucher.pickedUpAt
        ? new Date(voucher.pickedUpAt).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '-';
      pickupInfo = `Diambil oleh ${voucher.pickupCluster} ${voucher.pickupUnit || ''} pada ${dateStr}`.trim();
    }

    // Claim the voucher
    voucher.status = VoucherStatus.CLAIMED;
    voucher.claimedById = userId;
    voucher.claimedAt = new Date();
    const saved = await this.vouchersRepository.save(voucher);

    // Log successful scan
    await this.scanLogsRepository.save({
      voucherId: voucher.id,
      scannedById: userId,
      action: 'CLAIMED',
      notes: 'Voucher berhasil diklaim',
    });

    // Notify connected clients (Dashboard)
    this.vouchersGateway.notifyVoucherClaimed({ voucherCode });

    return { voucher: saved, message: 'Voucher berhasil diklaim!', pickupInfo };
  }

  async scanPickup(
    voucherCode: string,
    userId: string,
    pickupCluster: string,
    pickupUnit: string,
    pickupPhone: string | undefined,
  ): Promise<{ voucher: Voucher; message: string }> {
    let voucher: Voucher;
    try {
      voucher = await this.findByCode(voucherCode);
    } catch {
      throw new NotFoundException('Voucher tidak ditemukan');
    }

    if (voucher.status === VoucherStatus.DISTRIBUTED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah diambil sebelumnya',
      });
      throw new BadRequestException('Voucher sudah diambil sebelumnya');
    }

    if (voucher.status === VoucherStatus.CLAIMED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah diklaim di hari H',
      });
      throw new BadRequestException('Voucher sudah diklaim di hari H');
    }

    if (voucher.status === VoucherStatus.CANCELLED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah dibatalkan',
      });
      throw new BadRequestException('Voucher sudah dibatalkan');
    }

    voucher.status = VoucherStatus.DISTRIBUTED;
    voucher.pickupCluster = pickupCluster;
    voucher.pickupUnit = pickupUnit;
    voucher.pickupPhone = pickupPhone ?? null;
    voucher.pickedUpAt = new Date();
    voucher.pickedUpById = userId;
    const saved = await this.vouchersRepository.save(voucher);

    await this.scanLogsRepository.save({
      voucherId: voucher.id,
      scannedById: userId,
      action: 'PICKUP',
      notes: `Voucher diambil oleh ${pickupCluster} ${pickupUnit}`,
    });

    return {
      voucher: saved,
      message: 'Voucher berhasil dicatat sebagai sudah diambil',
    };
  }

  async generateBatchPdf(eventId: string): Promise<Buffer> {
    const vouchers = await this.vouchersRepository.find({
      where: { eventId, status: VoucherStatus.ACTIVE },
      relations: ['event'],
      order: { voucherCode: 'ASC' },
    });

    if (!vouchers || vouchers.length === 0) {
      throw new NotFoundException('Tidak ada voucher aktif untuk event ini');
    }

    return this.generatePdfBuffer(vouchers);
  }

  async generateSelectedPdf(ids: string[]): Promise<Buffer> {
    const vouchers = await this.vouchersRepository.find({
      where: ids.map((id) => ({ id })),
      relations: ['event'],
      order: { voucherCode: 'ASC' },
    });

    if (!vouchers || vouchers.length === 0) {
      throw new NotFoundException('Tidak ada voucher yang ditemukan');
    }

    return this.generatePdfBuffer(vouchers);
  }

  private generatePdfBuffer(vouchers: Voucher[]): Promise<Buffer> {
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

      // A4 = 595.28 x 841.89 points
      const PAGE_HEIGHT = 841.89;
      const ITEMS_PER_PAGE = 5;
      const PAGE_PADDING_TOP = 10;
      const PAGE_PADDING_BOTTOM = 10;
      const CARD_GAP = 8;
      const usableHeight = PAGE_HEIGHT - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM;
      // (5 * cardH) + (4 * CARD_GAP) = usableHeight
      const CARD_H = Math.floor(
        (usableHeight - (ITEMS_PER_PAGE - 1) * CARD_GAP) / ITEMS_PER_PAGE,
      );
      const CARD_X = 18;
      const CARD_W = 595.28 - 2 * CARD_X;

      const t = (text: string, x: number, y: number, opts: any = {}) => {
        doc.text(text, x, y, { ...opts, lineBreak: false });
      };

      for (let i = 0; i < vouchers.length; i++) {
        const voucher = vouchers[i];

        // New page every 5 vouchers
        if (i % ITEMS_PER_PAGE === 0) {
          doc.addPage({ size: 'A4', margin: 0 });
        }

        const slot = i % ITEMS_PER_PAGE;
        const y = PAGE_PADDING_TOP + slot * (CARD_H + CARD_GAP);

        // ═══════════════════════════════════════════════════
        // Layout constants relative to card
        // ═══════════════════════════════════════════════════
        const SEP_X = CARD_X + 400; // Dotted separator x
        const L = CARD_X + 18; // Left content margin
        const R_X = SEP_X + 14; // Right panel content start
        const R_W = CARD_X + CARD_W - R_X - 10; // Right panel content width

        // ─── Card Background ───
        doc.save();
        doc
          .roundedRect(CARD_X, y, CARD_W, CARD_H, 6)
          .fillAndStroke('#ffffff', '#e5e7eb');
        doc.restore();

        // ─── Top color bar (clipped inside rounded rect) ───
        doc.save();
        doc.roundedRect(CARD_X, y, CARD_W, CARD_H, 6).clip();
        doc.rect(CARD_X, y, CARD_W * 0.6, 4).fill('#10b981');
        doc.rect(CARD_X + CARD_W * 0.6, y, CARD_W * 0.4, 4).fill('#3b82f6');
        doc.restore();

        // ─── Left green accent bar ───
        doc.save();
        doc.roundedRect(CARD_X, y, CARD_W, CARD_H, 6).clip();
        doc.rect(CARD_X, y + 4, 4, CARD_H - 4).fill('#10b981');
        doc.restore();

        // ─── Background Watermark Logo ───
        doc.save();
        const WM_SIZE = 150;
        const WM_X = CARD_X + CARD_W / 2 - WM_SIZE / 2 - 40; // shift a bit to left of center to fit better
        const WM_Y = y + CARD_H / 2 - WM_SIZE / 2;

        let hasLogo = false;
        if (voucher.event?.logoPath) {
          const logoFile = path.join(
            process.cwd(),
            voucher.event.logoPath.replace('/api/uploads/', 'uploads/'),
          );
          if (fs.existsSync(logoFile)) {
            try {
              doc.opacity(0.1);
              doc.image(logoFile, WM_X, WM_Y, {
                width: WM_SIZE,
                height: WM_SIZE,
              });
              hasLogo = true;
              doc.opacity(1);
            } catch (e) {
              /* skip */
            }
          }
        }
        if (!hasLogo) {
          doc.opacity(0.1);
          doc
            .roundedRect(WM_X, WM_Y, WM_SIZE, WM_SIZE, 20)
            .fillAndStroke('#ecfdf5', '#d1fae5');
          doc.font('Helvetica-Bold').fontSize(32).fillColor('#10b981');
          t('CGE', WM_X, WM_Y + 32, { width: WM_SIZE, align: 'center' });
          doc.opacity(1);
        }
        doc.restore();

        // ─── Year Pill ───
        let yearText = '';
        if (voucher.distributionDate) {
          try {
            const hijriFormatter = new Intl.DateTimeFormat(
              'id-ID-u-ca-islamic',
              { year: 'numeric' },
            );
            const hijriParts = hijriFormatter
              .format(new Date(voucher.distributionDate))
              .split(' ');
            const hijri = hijriParts[0] + ' H';
            const masehi =
              new Date(voucher.distributionDate).getFullYear() + ' M';
            yearText = `Idul Adha ${hijri} / ${masehi}`;
          } catch {
            yearText = `Idul Adha ${voucher.event?.year || ''}`;
          }
        } else {
          yearText = `Idul Adha ${voucher.event?.year || ''}`;
        }
        const PILL_X = L;
        doc.roundedRect(PILL_X, y + 14, 170, 18, 9).fill('#ecfdf5');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#10b981');
        t(yearText, PILL_X, y + 19, { width: 170, align: 'center' });

        // ─── Title (below pill, aligned with pill) ───
        doc.font('Helvetica-Bold').fontSize(17).fillColor('#1a432e');
        t('KUPON DAGING KURBAN', PILL_X, y + 38);
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280');
        t('Masjid Al Hijrah CGE', PILL_X, y + 57);

        // ─── ID KUPON section ───
        const BOX_Y_LABEL = y + 76;
        const BOX_Y = y + 88;
        const BOX_H = 30;
        const BOX1_W = 178;
        const BOX2_X = L + BOX1_W + 14;
        const BOX2_W = 178;

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#6b7280');
        t('#  ID KUPON', L, BOX_Y_LABEL);
        doc
          .roundedRect(L, BOX_Y, BOX1_W, BOX_H, 5)
          .fillAndStroke('#f9fafb', '#e5e7eb');
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#10b981');
        t(voucher.voucherCode, L, BOX_Y + 9, {
          width: BOX1_W,
          align: 'center',
        });

        // ─── TANGGAL section ───
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#6b7280');
        t('TANGGAL', BOX2_X, BOX_Y_LABEL);
        doc
          .roundedRect(BOX2_X, BOX_Y, BOX2_W, BOX_H, 5)
          .fillAndStroke('#f9fafb', '#e5e7eb');
        const dateStr = voucher.distributionDate
          ? new Date(voucher.distributionDate).toLocaleDateString('id-ID', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : '-';
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827');
        t(dateStr, BOX2_X, BOX_Y + 10, { width: BOX2_W, align: 'center' });

        // ─── Footer info (bottom of left area) ───
        doc.font('Helvetica').fontSize(6.5).fillColor('#9ca3af');
        t(
          'ⓘ  Tunjukkan kupon ini saat pengambilan. Hanya panitia yang boleh memindai.',
          L,
          y + CARD_H - 18,
        );

        // ─── Dotted vertical separator ───
        doc.save();
        doc
          .moveTo(SEP_X, y + 10)
          .lineTo(SEP_X, y + CARD_H - 10)
          .lineWidth(1)
          .dash(3, { space: 3 })
          .stroke('#d1d5db');
        doc.undash();
        doc.restore();

        // ─── Right panel: QR Code (centered vertically) ───
        doc.roundedRect(R_X, y + 10, R_W, CARD_H - 20, 6).fill('#ecfdf5');

        const QR_SIZE = 92;
        const qrTextH = 18; // space for 2 lines of text below QR
        const qrTotalH = QR_SIZE + 6 + qrTextH; // QR + gap + text
        const qrPanelH = CARD_H - 20; // green panel height
        const qrOffsetY = (qrPanelH - qrTotalH) / 2; // center vertically
        const qrX = R_X + (R_W - QR_SIZE) / 2;
        const qrY = y + 10 + qrOffsetY;

        if (voucher.qrData && voucher.qrData.includes(',')) {
          try {
            const qrBuffer = Buffer.from(
              voucher.qrData.split(',')[1],
              'base64',
            );
            doc.image(qrBuffer, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });
          } catch (e) {
            /* skip */
          }
        }
        doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#10b981');
        t('SCAN UNTUK VERIFIKASI', R_X, qrY + QR_SIZE + 6, {
          width: R_W,
          align: 'center',
        });
        t('OLEH PANITIA', R_X, qrY + QR_SIZE + 14, {
          width: R_W,
          align: 'center',
        });
      }

      doc.end();
    });
  }

  private async generateUniqueCode(distributionDate: Date): Promise<string> {
    const hijriFormatter = new Intl.DateTimeFormat('en-US-u-ca-islamic', {
      year: 'numeric',
    });
    const hijriYearRaw = hijriFormatter.format(distributionDate);
    const hijriYear = hijriYearRaw.split(' ')[0];

    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let isUnique = false;

    while (!isUnique) {
      let randomPart = '';
      for (let i = 0; i < 10; i++) {
        randomPart += characters.charAt(
          Math.floor(Math.random() * characters.length),
        );
      }
      code = `QRB-${hijriYear}H-${randomPart}`;
      const existing = await this.vouchersRepository.findOne({
        where: { voucherCode: code },
      });
      if (!existing) {
        isUnique = true;
      }
    }
    return code;
  }

  async remove(id: string): Promise<void> {
    const voucher = await this.findById(id);
    // Delete scan logs first
    await this.scanLogsRepository.delete({ voucherId: id });
    await this.vouchersRepository.remove(voucher);
  }

  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    // Delete scan logs for all vouchers
    await this.scanLogsRepository
      .createQueryBuilder()
      .delete()
      .where('voucher_id IN (:...ids)', { ids })
      .execute();
    const result = await this.vouchersRepository
      .createQueryBuilder()
      .delete()
      .where('id IN (:...ids)', { ids })
      .execute();
    return { deleted: result.affected || 0 };
  }

  async bulkUpdateDate(
    ids: string[],
    newDate: string,
  ): Promise<{ updated: number }> {
    // Validate date against each voucher's event
    const vouchers = await this.vouchersRepository.find({
      where: ids.map((id) => ({ id })),
      relations: ['event'],
    });
    for (const voucher of vouchers) {
      if (voucher.event) {
        this.validateDistributionDate(newDate, voucher.event);
      }
    }
    const result = await this.vouchersRepository
      .createQueryBuilder()
      .update()
      .set({ distributionDate: new Date(newDate) as any })
      .where('id IN (:...ids)', { ids })
      .execute();
    return { updated: result.affected || 0 };
  }

  async updateDistributionDate(id: string, newDate: string): Promise<Voucher> {
    const voucher = await this.vouchersRepository.findOne({
      where: { id },
      relations: ['event'],
    });
    if (!voucher) throw new NotFoundException('Voucher tidak ditemukan');
    if (voucher.event) {
      this.validateDistributionDate(newDate, voucher.event);
    }
    voucher.distributionDate = new Date(newDate);
    return this.vouchersRepository.save(voucher);
  }

  private validateDistributionDate(
    distributionDate: string,
    event: Event,
  ): void {
    if (!distributionDate) return;
    const dist = new Date(distributionDate);
    if (event.startDate) {
      const start = new Date(event.startDate);
      start.setHours(0, 0, 0, 0);
      dist.setHours(0, 0, 0, 0);
      if (dist < start) {
        const s = start.toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        throw new BadRequestException(
          `Tanggal distribusi tidak boleh sebelum tanggal mulai event (${s})`,
        );
      }
    }
    if (event.endDate) {
      const end = new Date(event.endDate);
      end.setHours(23, 59, 59, 999);
      dist.setHours(0, 0, 0, 0);
      if (dist > end) {
        const e = end.toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        throw new BadRequestException(
          `Tanggal distribusi tidak boleh setelah tanggal selesai event (${e})`,
        );
      }
    }
  }

  async stats(eventId?: string) {
    const qb = this.vouchersRepository.createQueryBuilder('v');
    if (eventId) {
      qb.where('v.event_id = :eventId', { eventId });
    }

    const total = await qb.getCount();

    const claimed = await qb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.CLAIMED })
      .getCount();

    const active = await qb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.ACTIVE })
      .getCount();

    const cancelled = await qb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.CANCELLED })
      .getCount();

    const distributed = await qb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.DISTRIBUTED })
      .getCount();

    return { total, claimed, active, cancelled, distributed };
  }

  async getScanLogs(eventId?: string): Promise<ScanLog[]> {
    const qb = this.scanLogsRepository
      .createQueryBuilder('sl')
      .leftJoinAndSelect('sl.voucher', 'voucher')
      .leftJoinAndSelect('sl.scannedBy', 'scanner')
      .orderBy('sl.scannedAt', 'DESC')
      .take(50);

    if (eventId) {
      qb.andWhere('voucher.event_id = :eventId', { eventId });
    }

    const logs = await qb.getMany();
    return logs.map((l) => {
      if (l.scannedBy) delete (l.scannedBy as any).password;
      return l;
    });
  }
}
