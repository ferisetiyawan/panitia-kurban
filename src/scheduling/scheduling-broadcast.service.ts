import { Injectable, Logger } from '@nestjs/common';
import { SchedulingService, Team } from './scheduling.service';

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const KOLEKTIF_TYPES = ['SAPI_KOLEKTIF_A', 'SAPI_KOLEKTIF_B', 'SAPI_KOLEKTIF_C'];
const ANIMAL_LABELS: Record<string, string> = {
  SAPI_KOLEKTIF_A: 'Sapi Kolektif A',
  SAPI_KOLEKTIF_B: 'Sapi Kolektif B',
  SAPI_KOLEKTIF_C: 'Sapi Kolektif C',
  SAPI_KOLEKTIF: 'Sapi Kolektif',
  SAPI_PERORANGAN: 'Sapi',
  KAMBING: 'Kambing',
  DOMBA: 'Domba',
};

export type BroadcastTarget = 'sohibul_group' | 'panitia_group';

@Injectable()
export class SchedulingBroadcastService {
  private readonly logger = new Logger(SchedulingBroadcastService.name);

  constructor(private readonly schedulingService: SchedulingService) {}

  async buildSohibulMessage(eventId: string): Promise<string> {
    const lines: string[] = [];
    lines.push('📋 *JADWAL PENYEMBELIHAN — 1447H*');
    lines.push('');
    lines.push('Assalamualaikum bapak/ibu sohibul qurban,');
    lines.push('Berikut jadwal penyembelihan Idul Adha:');
    lines.push('');

    for (const team of ['SAPI', 'KAMBING_DOMBA'] as Team[]) {
      const items = await this.schedulingService.getSchedule(eventId, team);
      const label = team === 'SAPI' ? 'SAPI' : 'KAMBING/DOMBA';
      lines.push(`*Tim ${label}* (${items.length} hewan)`);
      for (const it of items) {
        if (!it.animal.scheduledAt) continue;
        const time = fmtTime(new Date(it.animal.scheduledAt));
        const names = it.pengkurban.map((pk: any) => pk.name).filter(Boolean);
        const isKolektif = KOLEKTIF_TYPES.includes(it.animal.animalType);
        let line: string;
        if (isKolektif) {
          const animalLabel = ANIMAL_LABELS[it.animal.animalType] || it.animal.animalType;
          line =
            names.length > 0
              ? `${time} — ${animalLabel} (${names.join(', ')})`
              : `${time} — ${animalLabel}`;
        } else {
          line = `${time} — ${names[0] ?? '(tanpa sohibul)'}`;
        }
        lines.push(line);
      }
      lines.push('');
    }

    lines.push('📍 Margata 8');
    lines.push('⏰ Mohon hadir min. 15 menit sebelum slot Anda');
    lines.push('🔗 Detail di portal: https://kurban.masjidalhijrahcge.id/portal.html');
    lines.push('');
    lines.push('Jazakumullahu khairan,');
    lines.push('Panitia Kurban');
    return lines.join('\n');
  }

  async buildPanitiaMessage(
    eventId: string,
    summary: { overflow?: number; mismatches?: number; generatedBy?: string },
  ): Promise<string> {
    let base = await this.buildSohibulMessage(eventId);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${fmtTime(now)} WIB`;
    base += `\n\n_Generated ${stamp} by ${summary.generatedBy ?? 'admin'}_`;
    if (summary.overflow && summary.overflow > 0) {
      base += `\n⚠️ ${summary.overflow} hewan overflow di luar target 12:00`;
    }
    if (summary.mismatches && summary.mismatches > 0) {
      base += `\n⚠️ ${summary.mismatches} preferensi waktu tidak ter-honor (lihat dashboard)`;
    }
    return base;
  }

  resolveGroupJid(target: BroadcastTarget): string | null {
    if (target === 'sohibul_group') {
      return process.env.WA_SOHIBUL_GROUP_JID || null;
    }
    if (target === 'panitia_group') {
      return process.env.WA_PANITIA_GROUP_JID || process.env.WA_NOTIFY_PHONE || null;
    }
    return null;
  }

  /**
   * JIT reminder: WA ke sohibul next-up bahwa hewan mereka segera dipotong.
   * Called when current animal transitions to IN_PROGRESS.
   */
  async sendJitReminder(
    nextAnimalSohibul: Array<{ name: string; phone: string }>,
    nextAnimalLabel: string,
  ): Promise<{ sent: number; failed: string[] }> {
    if (nextAnimalSohibul.length === 0) return { sent: 0, failed: [] };
    const url = process.env.WA_BOT_URL;
    const key = process.env.WA_BOT_API_KEY;
    if (!url || !key) {
      this.logger.warn('wa-bot not configured; skipping JIT reminder');
      return { sent: 0, failed: ['env_missing'] };
    }
    const failed: string[] = [];
    let sent = 0;
    for (const s of nextAnimalSohibul) {
      const message =
        `Assalamualaikum ${s.name},\n\n` +
        `Hewan qurban Anda (${nextAnimalLabel}) sebentar lagi akan disembelih (next-up). ` +
        `Mohon hadir di area penyembelihan Masjid Al Hijrah CGE sekarang.\n\n` +
        `Jazakumullahu khairan,\nPanitia Kurban`;
      try {
        const res = await fetch(`${url}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({ to: s.phone, message }),
        });
        if (!res.ok) {
          const txt = await res.text();
          failed.push(`${s.phone}: ${res.status} ${txt}`);
        } else {
          sent++;
        }
      } catch (e) {
        failed.push(`${s.phone}: ${(e as Error).message}`);
      }
    }
    return { sent, failed };
  }

  /**
   * Auto-broadcast foto: WA ke sohibul tidak-hadir bahwa hewan mereka udah dipotong + link foto.
   */
  async sendFotoBroadcast(
    tidakHadirSohibul: Array<{ name: string; phone: string }>,
    animalLabel: string,
    photoUrls: string[],
  ): Promise<{ sent: number; failed: string[] }> {
    if (tidakHadirSohibul.length === 0) return { sent: 0, failed: [] };
    const url = process.env.WA_BOT_URL;
    const key = process.env.WA_BOT_API_KEY;
    if (!url || !key) {
      this.logger.warn('wa-bot not configured; skipping foto broadcast');
      return { sent: 0, failed: ['env_missing'] };
    }
    const failed: string[] = [];
    let sent = 0;
    const fotoLinks = photoUrls.length
      ? photoUrls.map((u) => `• ${u}`).join('\n')
      : '(belum ada foto, akan menyusul)';
    const message = (name: string) =>
      `Assalamualaikum ${name},\n\n` +
      `Hewan qurban Anda (${animalLabel}) telah selesai disembelih. Berikut foto/video:\n\n` +
      `${fotoLinks}\n\n` +
      `Jazakumullahu khairan,\nPanitia Kurban Masjid Al Hijrah CGE`;
    for (const s of tidakHadirSohibul) {
      try {
        const res = await fetch(`${url}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({ to: s.phone, message: message(s.name) }),
        });
        if (!res.ok) {
          const txt = await res.text();
          failed.push(`${s.phone}: ${res.status} ${txt}`);
        } else {
          sent++;
        }
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        failed.push(`${s.phone}: ${(e as Error).message}`);
      }
    }
    return { sent, failed };
  }

  async sendToGroup(groupJid: string, message: string): Promise<void> {
    const url = process.env.WA_BOT_URL;
    const key = process.env.WA_BOT_API_KEY;
    if (!url || !key) {
      this.logger.warn('WA_BOT_URL or WA_BOT_API_KEY not set — skipping send');
      return;
    }
    try {
      // wa-bot /send body: { to, message } — `to` accepts both phone (628xxx)
      // and group JID (xxx@g.us). See wa-bot index.js:614-629.
      const res = await fetch(`${url}/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({ to: groupJid, message }),
      });
      if (!res.ok) {
        throw new Error(`wa-bot returned ${res.status}: ${await res.text()}`);
      }
    } catch (e) {
      const err = e as Error;
      console.error('[scheduling-broadcast sendToGroup]', err.stack || err.message);
      throw err;
    }
  }
}
