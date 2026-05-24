import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FormResponsesService } from './form-responses.service';
import { FormResponse } from './form-response.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { WaNotifierService } from '../common/notifications/wa-notifier.service';

@Injectable()
export class SyncCronService {
  private readonly logger = new Logger(SyncCronService.name);

  constructor(
    private readonly service: FormResponsesService,
    private readonly waNotifier: WaNotifierService,
    @InjectRepository(Pengkurban)
    private readonly pengkurbanRepo: Repository<Pengkurban>,
    @InjectRepository(FormResponse)
    private readonly formRepo: Repository<FormResponse>,
  ) {}

  // PM2 cluster mode: only worker 0 runs cron to avoid duplicate Sheets reads.
  // NODE_APP_INSTANCE is set by PM2 per worker (0..N-1). Unset = single-instance.
  private isPrimaryWorker(): boolean {
    return (
      !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0'
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncKonfirmasiTeknis() {
    if (!this.isPrimaryWorker()) return;

    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    const sheetId = process.env.KONFIRMASI_TEKNIS_SHEET_ID;
    const range = process.env.KONFIRMASI_TEKNIS_RANGE;

    if (!formKey || !sheetId || !range) {
      this.logger.warn('Konfirmasi teknis env vars missing — skip cron tick');
      return;
    }

    try {
      const summary = await this.service.syncFromSheet(formKey, sheetId, range);

      // Event-driven notif: only fire when at least one new submission was
      // inserted this run. Silent otherwise (10-min ticks would be too noisy).
      if (summary.newRegs.length > 0) {
        await this.notifyNewSubmissions(formKey, summary.newRegs);
      }
    } catch (e) {
      const err = e as Error;
      console.error('[sync-cron konfirmasi-teknis]', err.stack || err.message);
    }
  }

  /**
   * Daily recap @ 08:00 & 20:00 WIB — kirim list pengkurban yang masih belum isi
   * konfirmasi teknis form, regardless of new submission. Cron expression
   * `0 8,20 * * *` runs at minute 0 of hour 8 and 20.
   */
  @Cron('0 8,20 * * *', { timeZone: 'Asia/Jakarta' })
  async dailyRecapKonfirmasiTeknis() {
    if (!this.isPrimaryWorker()) return;

    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    if (!formKey) return;

    try {
      const unfilled = await this.queryUnfilledPengkurban(formKey);
      const message = this.buildDailyRecapMessage(unfilled);
      this.waNotifier.send(message);
    } catch (e) {
      const err = e as Error;
      console.error(
        '[sync-cron daily-recap]',
        err.stack || err.message,
      );
    }
  }

  private async notifyNewSubmissions(formKey: string, newRegs: string[]) {
    const newOnes = await this.pengkurbanRepo.find({
      where: newRegs.map((reg) => ({ registrationNumber: reg })),
      select: ['registrationNumber', 'name'],
      order: { registrationNumber: 'ASC' },
    });
    const unfilled = await this.queryUnfilledPengkurban(formKey);

    const newList = newOnes
      .map((p) => `• ${p.name} (${p.registrationNumber})`)
      .join('\n');
    const unfilledList =
      unfilled.length === 0
        ? 'Semua pengkurban sudah isi form 🎉'
        : unfilled
            .map((p) => `• ${p.name} (${p.registrationNumber})`)
            .join('\n');

    const message =
      `🆕 *Form konfirmasi teknis* — ${newOnes.length} baru isi\n\n` +
      `${newList}\n\n` +
      `*Sisa belum isi (${unfilled.length}):*\n${unfilledList}`;
    this.waNotifier.send(message);
  }

  private buildDailyRecapMessage(unfilled: Pengkurban[]): string {
    if (unfilled.length === 0) {
      return '✅ *Rekap harian form konfirmasi teknis*\n\nSemua pengkurban sudah isi form 🎉';
    }
    const list = unfilled
      .map((p) => `• ${p.name} (${p.registrationNumber})`)
      .join('\n');
    return (
      `📋 *Rekap harian — pengkurban belum isi form konfirmasi teknis*\n` +
      `Total: ${unfilled.length}\n\n${list}`
    );
  }

  /**
   * Active pengkurban (non-deleted, status != REJECTED) yang BELUM punya form
   * response untuk formKey. Order by registration_number ASC.
   *
   * Env `KONFIRMASI_TEKNIS_EXCLUDE_REGS` (comma-separated registration_number)
   * di-exclude dari hasil — pakai untuk pengkurban yang motong di luar / opt-out
   * dari form. Whitespace di-trim.
   */
  private async queryUnfilledPengkurban(
    formKey: string,
  ): Promise<Pengkurban[]> {
    const excludeRegs = (process.env.KONFIRMASI_TEKNIS_EXCLUDE_REGS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const qb = this.pengkurbanRepo
      .createQueryBuilder('p')
      .leftJoin(
        FormResponse,
        'f',
        'f.pengkurban_id = p.id AND f.form_key = :formKey',
        { formKey },
      )
      .where('p.deleted_at IS NULL')
      .andWhere('p.status != :rejected', { rejected: 'REJECTED' })
      .andWhere('f.id IS NULL');

    if (excludeRegs.length > 0) {
      qb.andWhere('p.registration_number NOT IN (:...excludeRegs)', {
        excludeRegs,
      });
    }

    return qb.orderBy('p.registration_number', 'ASC').getMany();
  }
}
