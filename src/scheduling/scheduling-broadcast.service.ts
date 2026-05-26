import { Injectable, Logger } from '@nestjs/common';
import { SchedulingService, Team } from './scheduling.service';

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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
        let line = `${time} — ${names[0] ?? '(tanpa sohibul)'}`;
        if (names.length > 1) {
          line += ` (kolektif: ${names.join(', ')})`;
        }
        lines.push(line);
      }
      lines.push('');
    }

    lines.push('📍 Halaman Masjid Al Hijrah CGE');
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
