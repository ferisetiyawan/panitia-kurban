import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { Donation } from '../donations/donation.entity';
import { getInfaqAmount } from '../common/constants/infaq';

function displayName(p: Pengkurban): string {
  return (p.shohibulName || p.name).split('\n')[0].trim();
}

// Returns true if pengkurban row has waiver marker in `notes` — infaq via
// potongan daging atau institutional sumbangan (e.g., BPKH), bukan cash.
// Marker convention: notes contains literal `infaq:potongan` or `infaq:waived`.
// Colon separator is required to avoid false-positive matches on free-form
// notes that happen to mention "infaq" near common Indonesian words.
function hasInfaqWaiver(p: Pengkurban): boolean {
  if (!p || !p.notes) return false;
  return /infaq\s*:\s*(potongan|waived)/i.test(p.notes);
}

// Cek apakah row punya bukti pembayaran ke-upload (file paths non-empty).
// PENDING_VERIFICATION rows tanpa proof biasanya admin manual entry (intent
// declaration), bukan transfer beneran yang nunggu finance verify.
function hasProof(p: { paymentProofPaths?: string[] | null }): boolean {
  return Array.isArray(p.paymentProofPaths) && p.paymentProofPaths.length > 0;
}


const REKENING_DEFAULT =
  'Rekening Bank Muamalat | 12 1010 4479 a/n Masjid Al Hijrah CGE 11';

// Rekening line yang ditampilkan di akhir rekap. Override pakai env
// REKAP_REKENING (kalau bank/rekening berubah tahun depan, ga perlu code change).
function getRekening(): string {
  return process.env.REKAP_REKENING?.trim() || REKENING_DEFAULT;
}

// Display-oriented blok extractor for rekap pengkurban. Returns uppercase,
// space-separated tokens matching the format panitia broadcasts use
// (e.g. "NHT 3/50", "M6/102"). MGT cluster di-normalize ke M (per konvensi
// broadcast). Empty string if no address.
function formatBlokShort(addr: string | null | undefined): string {
  if (!addr) return '';
  let s = String(addr).split('\n')[0].trim();
  if (!s) return '';
  s = s.replace(/^(Margata\s*-\s*)+/i, '');
  let m = s.match(/^Nahara(?:\s+Timur)?\s*-\s*(.+)$/i);
  if (m) {
    const rest = m[1].trim();
    // "NHT8-16" / "NHT 8/16" / "8-16" / "8/16" → "NHT 8/16"
    const numPair = rest.match(/^(?:NHT\s*)?(\d+)\s*[-/\\]\s*(\d+)\s*$/i);
    if (numPair) return `NHT ${numPair[1]}/${numPair[2]}`;
    const nht = rest.match(/^NHT\s*(.+)$/i);
    return nht ? `NHT ${nht[1].trim()}` : `NHT ${rest}`;
  }
  m = s.match(/Margata\s+(\d+)\s+no\.?\s*(\d+)/i);
  if (m) return `M${m[1]}/${m[2]}`;
  m = s.match(/^Margata\s*(\d+)\s*[/\\]\s*(\d+)/i);
  if (m) return `M${m[1]}/${m[2]}`;
  m = s.match(/^Uenos\s*(\d+)\s*[/\\]\s*(\d+)/i);
  if (m) return `U${m[1]}/${m[2]}`;
  // MGT → M: "MGT 6/28" → "M6/28", "MGT 3" → "M3"
  m = s.match(/^MGT\s*(\d+)\s*[/\\]\s*(\d+)/i);
  if (m) return `M${m[1]}/${m[2]}`;
  m = s.match(/^MGT\s*(\d+)\b/i);
  if (m) return `M${m[1]}`;
  m = s.match(/^M\s*(\d+)\s*[/\\]\s*(\d+)/i);
  if (m) return `M${m[1]}/${m[2]}`;
  m = s.match(/^M\s*(\d+)\b/i);
  if (m) return `M${m[1]}`;
  m = s.match(/^NHT\s*(.+)$/i);
  if (m) return `NHT ${m[1].trim()}`;
  return s;
}

// Normalize name untuk merge key — extract first significant token
// (skip honorifics & single-letter abbreviations like "H").
function nameKey(name: string | null | undefined): string {
  if (!name) return '';
  const HONORIFICS =
    /^(h|hj|bu|pak|mas|mba|mbak|ibu|bapak|bpk|bin|binti|alm|almarhum|almarhumah|al|tn|ny)$/i;
  const tokens = String(name)
    .split('\n')[0]
    .toLowerCase()
    .replace(/[.,()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !HONORIFICS.test(t));
  return tokens[0] || '';
}

function formatRibu(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return '';
  // ≥ 1 juta: pakai unit "juta" (2 desimal max, no trailing zeros).
  // 1_000_000 → "1 juta", 1_750_000 → "1.75 juta", 2_050_000 → "2.05 juta".
  if (amount >= 1_000_000) {
    const juta = amount / 1_000_000;
    const str = juta.toFixed(2).replace(/\.?0+$/, '');
    return `${str} juta`;
  }
  if (amount % 1000 === 0) return `${amount / 1000} ribu`;
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

@Injectable()
export class RekapService {
  constructor(
    @InjectRepository(Pengkurban)
    private pengkurbanRepo: Repository<Pengkurban>,
    @InjectRepository(Donation)
    private donationRepo: Repository<Donation>,
  ) {}

  private async fetchPengkurban(eventId?: string): Promise<Pengkurban[]> {
    const where = eventId ? { eventId } : {};
    return this.pengkurbanRepo.find({
      where,
      relations: ['event'],
      order: { createdAt: 'ASC' },
    });
  }

  private async fetchDonations(eventId?: string): Promise<Donation[]> {
    const where = eventId ? { eventId } : {};
    return this.donationRepo.find({
      where,
      relations: ['event'],
      order: { createdAt: 'ASC' },
    });
  }

  async getPengkurbanRekap(eventId?: string): Promise<string> {
    const data = await this.fetchPengkurban(eventId);
    const active = data.filter((d) => d.status !== ('REJECTED' as never));

    const sapiA = active.filter(
      (d) => d.animalType === ('SAPI_KOLEKTIF_A' as never),
    );
    const sapiB = active.filter(
      (d) => d.animalType === ('SAPI_KOLEKTIF_B' as never),
    );
    const sapiC = active.filter(
      (d) => d.animalType === ('SAPI_KOLEKTIF_C' as never),
    );
    const sapiLegacy = active.filter(
      (d) => d.animalType === ('SAPI_KOLEKTIF' as never),
    );
    const sapiPerorangan = active.filter(
      (d) => d.animalType === ('SAPI_PERORANGAN' as never),
    );
    const kambingDomba = active.filter(
      (d) =>
        d.animalType === ('KAMBING' as never) ||
        d.animalType === ('DOMBA' as never),
    );

    const check = (d: Pengkurban) => (d.infaqPaid ? ' ✅' : '');
    const blok = (d: Pengkurban) => {
      const b = formatBlokShort(d.address);
      return b ? ` ${b}` : '';
    };

    const lines: string[] = [
      `*Daftar Pengkurban*`,
      ``,
      `Keterangan: ✅ = sudah verifikasi infaq`,
      ``,
    ];

    const renderKolektif = (rows: Pengkurban[], header: string) => {
      lines.push(header);
      for (let i = 0; i < 7; i++) {
        const d = rows[i];
        if (d) lines.push(`${i + 1}. ${displayName(d)}${blok(d)}${check(d)}`);
        else lines.push(`${i + 1}. ...`);
      }
      lines.push(``);
    };

    if (sapiA.length || sapiB.length || sapiC.length || sapiLegacy.length) {
      lines.push(`Qurban Sapi Kolektif`);
      renderKolektif(sapiA, `• Sapi A 350 - 400 Kg Rp 4.000.000 / orang`);
      renderKolektif(
        sapiB,
        `• Sapi B 320 - 350 Kg Rp 3.500.000 / orang (sudah termasuk infaq)`,
      );
      renderKolektif(
        sapiC,
        `• Sapi C 320 - 350 Kg Rp 3.500.000 / orang (sudah termasuk infaq)`,
      );
      if (sapiLegacy.length) renderKolektif(sapiLegacy, `• Sapi Kolektif`);
    }

    lines.push(`Qurban Sapi perorangan`);
    if (sapiPerorangan.length) {
      sapiPerorangan.forEach((d, i) =>
        lines.push(`${i + 1}. ${displayName(d)}${blok(d)}${check(d)}`),
      );
      // Open slot di akhir — invite jamaah yang mau ikut nimbrung
      lines.push(`${sapiPerorangan.length + 1}. ...`);
    } else {
      [1, 2, 3].forEach((i) => lines.push(`${i}. ...`));
    }
    lines.push(``);

    lines.push(`Qurban Kambing dan Domba`);
    if (kambingDomba.length) {
      kambingDomba.forEach((d, i) => {
        const jenis = d.animalType === ('DOMBA' as never) ? 'Domba' : 'Kambing';
        const isBawaSendiri = d.purchaseType === ('BAWA_SENDIRI' as never);
        // animal_size legacy yg berisi "bawa sendiri" (manual workaround sebelum
        // logic ini ada) di-skip biar ga dobel.
        const sizeStr =
          d.animalSize && !/bawa\s*sendiri/i.test(d.animalSize)
            ? d.animalSize
            : '';
        const suffix = isBawaSendiri
          ? ` - Bawa sendiri${sizeStr ? ' ' + sizeStr : ''}`
          : sizeStr
            ? ` - ${sizeStr}`
            : '';
        lines.push(
          `${i + 1}. ${displayName(d)} (${jenis}${suffix})${blok(d)}${check(d)}`,
        );
      });
      // Open slot di akhir — invite jamaah yang mau ikut nimbrung
      lines.push(`${kambingDomba.length + 1}. ...`);
    } else {
      [1, 2, 3].forEach((i) => lines.push(`${i}. ...`));
    }
    lines.push(``);

    const infoPemesanan = process.env.REKAP_INFO_PEMESANAN?.trim();
    if (infoPemesanan) {
      lines.push(infoPemesanan);
      lines.push(``);
    }

    lines.push(`Pembayaran:`);
    lines.push(getRekening());
    lines.push(``);

    lines.push(`Jazakumullahu Khairan.`);
    lines.push(``);
    lines.push(`Panitia Idul Adha 1447 H`);
    lines.push(`DKM Al Hijrah – Cluster Maranos CGE`);

    return lines.join('\n');
  }

  async getDonasiRekap(eventId?: string): Promise<string> {
    const [donations, pengkurban] = await Promise.all([
      this.fetchDonations(eventId),
      this.fetchPengkurban(eventId),
    ]);

    // Merged single list: pengkurban (sohibul infaq) + donations (sukarela).
    // ✅ rule:
    //  - Pengkurban: ✅ kalau bukan PENDING_PAYMENT atau infaq_paid sudah true.
    //    Status PENDING_VERIFICATION → ✅ (bank statement masih nunggu, finance
    //    belum bisa verify tapi pembayar udah upload bukti).
    //  - Donation: ✅ kalau non-REJECTED (status di donasi: CONFIRMED atau
    //    PENDING_VERIFICATION → keduanya ✅).
    //  - Pengkurban dengan infaq waiver marker (potongan / waived) di-skip dari list.
    type Entry = {
      name: string;
      blok: string;
      amount: number;
      checked: boolean;
      createdAt: Date;
    };

    type Raw = {
      displayLabel: string; // nama mentah, buat fallback display kalau blok kosong
      blok: string;
      amount: number;
      checked: boolean;
      createdAt: Date;
      key: string; // merge key: blok + first-name-token
    };

    const raws: Raw[] = [];

    pengkurban
      .filter(
        (d) =>
          d.status !== ('REJECTED' as never) &&
          !hasInfaqWaiver(d) &&
          // Waiver via kolom infaq_amount: null = di-skip dari rekap. Source
          // of truth baru — admin set null via UI buat flag jamaah yang ga
          // perlu bayar cash infaq (mis. bawa sendiri + potongan daging).
          d.infaqAmount !== null &&
          d.infaqAmount !== undefined,
      )
      .forEach((d) => {
        const dn = displayName(d);
        const blok = formatBlokShort(d.address);
        // ✅ rule:
        //  - infaq_paid=true → ✅ (admin sudah confirm cash infaq received)
        //  - BELI_MASJID + CONFIRMED → ✅ (paid in full termasuk infaq)
        //  - PENDING_VERIFICATION + ada bukti upload → ✅ (proof there, finance
        //    pending rekening koran)
        // BAWA_SENDIRI + CONFIRMED (tanpa infaq_paid=true) ga otomatis ✅ —
        // CONFIRMED untuk bawa-sendiri cuma konfirmasi reg, bukan cash flow.
        const isBawaSendiri =
          d.purchaseType === ('BAWA_SENDIRI' as never);
        const checked =
          d.infaqPaid === true ||
          (!isBawaSendiri && d.status === ('CONFIRMED' as never)) ||
          (d.status === ('PENDING_VERIFICATION' as never) && hasProof(d));
        raws.push({
          displayLabel: dn,
          blok,
          amount: Number(d.infaqAmount),
          checked,
          createdAt: d.createdAt,
          key: blok ? `${blok}::${nameKey(dn)}` : `noblok::${dn}`,
        });
      });

    donations
      .filter((d) => d.status !== ('REJECTED' as never))
      .forEach((d) => {
        const blok = formatBlokShort(d.address);
        // Donation ✅: CONFIRMED langsung ✅, PENDING_VERIFICATION cuma kalau
        // ada bukti upload. Donation tanpa proof = admin manual record intent,
        // bukan transfer yang nunggu finance.
        const checked =
          d.status === ('CONFIRMED' as never) ||
          (d.status === ('PENDING_VERIFICATION' as never) && hasProof(d));
        raws.push({
          displayLabel: d.name,
          blok,
          amount: d.amount == null ? 0 : Number(d.amount),
          checked,
          createdAt: d.createdAt,
          key: blok ? `${blok}::${nameKey(d.name)}` : `noblok::${d.name}`,
        });
      });

    // Merge raws dengan key sama — sum amounts, AND-merge checked (semua
    // pieces harus ✅ supaya merged entry juga ✅), earliest createdAt.
    // Privacy: display pakai blok kalau ada, fallback ke nama.
    const grouped = new Map<string, Entry>();
    raws.forEach((r) => {
      const existing = grouped.get(r.key);
      if (existing) {
        existing.amount += r.amount;
        existing.checked = existing.checked && r.checked;
        if (
          r.createdAt &&
          (!existing.createdAt ||
            new Date(r.createdAt).getTime() <
              new Date(existing.createdAt).getTime())
        ) {
          existing.createdAt = r.createdAt;
        }
      } else {
        grouped.set(r.key, {
          name: r.blok ? '' : r.displayLabel,
          blok: r.blok,
          amount: r.amount,
          checked: r.checked,
          createdAt: r.createdAt,
        });
      }
    });

    const entries: Entry[] = [...grouped.values()];

    entries.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });

    const lines: string[] = [`*List Sumbangan Kegiatan Idul Qurban*`, ``];

    if (entries.length) {
      entries.forEach((e, i) => {
        const parts = [`${i + 1}.`];
        if (e.name) parts.push(e.name);
        if (e.blok) parts.push(e.blok);
        const amt = formatRibu(e.amount);
        if (amt) parts.push(amt);
        if (e.checked) parts.push('✅');
        lines.push(parts.join(' '));
      });
    } else {
      [1, 2, 3].forEach((i) => lines.push(`${i}. ...`));
    }
    lines.push(``);

    lines.push(getRekening());
    lines.push(``);
    lines.push(
      `Donasi online: https://kurban.masjidalhijrahcge.id/donate.html`,
    );
    lines.push(``);
    lines.push(`Konfirmasi`);
    lines.push(
      `di: https://kurban.masjidalhijrahcge.id  atau Whatsapp ke Fajar Firdaus (0812-7149-927) / Panitia Kurban (0851-2151-9870).`,
    );
    lines.push(``);
    lines.push(`Jazakumullahu Khairan.`);
    lines.push(``);
    lines.push(`Panitia Idul Adha 1447 H`);
    lines.push(`DKM Al Hijrah – Cluster Maranos CGE`);

    return lines.join('\n');
  }
}
