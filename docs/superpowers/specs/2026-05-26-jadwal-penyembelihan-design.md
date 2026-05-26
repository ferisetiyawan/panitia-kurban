# Jadwal Penyembelihan — Design Spec (Phase 1)

**Status:** Draft, awaiting review
**Date:** 2026-05-26
**Author:** Fajar (with Claude)
**Target event:** 1447H (Idul Adha 2026)

---

## 1. Context & Motivation

Saat ini panitia kurban Masjid Al Hijrah CGE mengoperasikan penyembelihan hari-H tanpa jadwal terstruktur. Sohibul qurban mengisi preferensi waktu lewat Google Form "Konfirmasi Teknis" (data ke-sync ke `pengkurban_form_responses`), tapi tidak ada mekanisme untuk:

- Menyusun timetable per tim (sapi vs kambing/domba)
- Memberi tahu sohibul kapan harus hadir
- Memprint jadwal untuk dipasang di tenda jagal
- Membatasi target waktu (selesai sebelum jam 12:00)

Phase 1 menjawab gap ini: **generator jadwal otomatis dari data form preferensi + hewan terdaftar, dengan output ke admin UI, PDF cetak, post WA grup, dan portal sohibul.**

Phase 2 (operasional hari-H: status WAITING/IN_PROGRESS/DONE, live view antrian, JIT reminder, foto per hewan) dan Phase 3 (workflow foto terintegrasi) di luar scope spec ini — akan punya spec sendiri.

## 2. Scope

### In-scope (Phase 1)

| Komponen | Pengguna |
|---|---|
| Algoritma jadwal generator (soft-honor preferensi) | — (backend) |
| `client/jadwal.html` — admin generate/edit/export/broadcast | SUPER_ADMIN, KETUA_PANITIA |
| PDF jadwal A4 untuk print di tenda (kolom: jam, sohibul, **permintaan ringkas**) | Admin |
| **`client/seset.html` + PDF cheat sheet tim jagal/seset** (detail permintaan per hewan) | SUPER_ADMIN, KETUA_PANITIA, PANITIA_VOUCHER, PANITIA_SCANNER |
| WA broadcast ke grup sohibul + grup panitia (via wa-bot) | Admin trigger |
| Section "Jadwal Anda" di `portal-dashboard.html` | Sohibul (existing portal auth) |
| Endpoint `GET /api/scheduling` (JSON, dipakai admin UI + portal) | Authenticated |

### Non-goals (Phase 1)

- ❌ Pesan WA individual ke nomor sohibul (risk ban — replaced by grup post)
- ❌ Status operasional hewan WAITING / IN_PROGRESS / DONE (Phase 2)
- ❌ Live view antrian real-time di portal sohibul (Phase 2)
- ❌ JIT WA reminder "hewan kamu next up" (Phase 2)
- ❌ Foto hasil potong workflow (Phase 3 — endpoint `POST /animals/:id/photo` sudah ada)
- ❌ Multi-event scheduling (asumsi 1 event aktif)
- ❌ History / audit log perubahan jadwal
- ❌ Sohibul self-service edit jadwal
- ❌ Smart re-schedule yang preserve manual override (Phase 1 regenerate = overwrite)

## 3. Architecture

Modul baru `src/scheduling/`:

```
src/scheduling/
  scheduling.module.ts
  scheduling.service.ts            ← generator algorithm + queries
  scheduling.controller.ts          ← admin endpoints (JWT + role guard)
  scheduling.public.controller.ts   ← read-only GET untuk sohibul portal
  scheduling-broadcast.service.ts   ← build WA messages, call wa-bot
  scheduling-pdf.service.ts         ← PDF export (pdfkit, pola dari vouchers)
  scheduling-mappers.ts             ← parsePreferensiTime, helpers
  scheduling.service.spec.ts
  scheduling-mappers.spec.ts
  scheduling-broadcast.service.spec.ts
  scheduling-pdf.service.spec.ts
```

Dependencies (di-import via module):
- `TypeOrmModule.forFeature([Animal, Pengkurban, FormResponse])`
- `NotificationsModule` (for `WaNotifierService`)
- `AuthModule` (JWT + role guards)

Module di-register di `src/app.module.ts`.

## 4. Data Model

Extend tabel `animals` (1:1 relationship dengan jadwal — tidak ada tabel terpisah di Phase 1):

| Kolom | Tipe | Nullable | Note |
|---|---|---|---|
| `scheduled_at` | `timestamptz` | YES | NULL = belum dijadwalkan |
| `scheduled_team` | `varchar(20)` | YES | CHECK (`'SAPI'` \| `'KAMBING_DOMBA'`) |
| `scheduled_note` | `text` | YES | Catatan admin (mis. "datang telat") |

**`scheduled_team` derivation** (deterministic dari `animal_type`):
- `SAPI_PERORANGAN` / `SAPI_KOLEKTIF_A` / `SAPI_KOLEKTIF_B` / `SAPI_KOLEKTIF_C` → `SAPI`
- `KAMBING` / `DOMBA` → `KAMBING_DOMBA`

Disimpan eksplisit di kolom (bukan derived per-query) supaya bisa di-index.

**Indexes:**
```sql
CREATE INDEX idx_animals_scheduled_at ON animals (scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_animals_scheduled_team_at ON animals (scheduled_team, scheduled_at);
```

**Migration SQL** (run manual di Neon sebelum deploy, karena `DB_SYNCHRONIZE=false` di prod):

```sql
ALTER TABLE animals
  ADD COLUMN scheduled_at TIMESTAMPTZ NULL,
  ADD COLUMN scheduled_team VARCHAR(20) NULL,
  ADD COLUMN scheduled_note TEXT NULL,
  ADD CONSTRAINT chk_animals_scheduled_team
    CHECK (scheduled_team IS NULL OR scheduled_team IN ('SAPI','KAMBING_DOMBA'));

CREATE INDEX idx_animals_scheduled_at
  ON animals (scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE INDEX idx_animals_scheduled_team_at
  ON animals (scheduled_team, scheduled_at);
```

## 5. Algorithm

### Input
- `eventId` (UUID event aktif)
- Animals scope: semua `animals` di event tsb kecuali `is_vendor_animal=false AND` (individual animal yang pengkurban-nya sudah deleted atau status REJECTED). Konkrit:
  - **Individual** (`pengkurban_id IS NOT NULL`): include kalau pengkurban `deleted_at IS NULL AND status IN ('CONFIRMED','PENDING_VERIFICATION')`
  - **Kolektif** (`animal_type` IN SAPI_KOLEKTIF_*): include kalau ada ≥1 eligible pengkurban matching `(event_id, animal_type)`. Kalau 0 eligible → skip animal (mungkin semua sohibul-nya REJECTED setelah animal di-generate)
  - **Vendor** (`is_vendor_animal=true`): selalu include — preferensi tidak ada, masuk bucket FLEX
- Form responses dengan `form_key = $KONFIRMASI_TEKNIS_FORM_KEY` (env), kolom JSONB `data["Preferensi waktu penyembelihan"]`

### Steps (dijalankan 2x — per tim SAPI dan KAMBING_DOMBA)

```
1. Build slot grid untuk tim:
   - Mulai 07:30 WIB, step 15 menit
   - Awal 18 slot (07:30 - 11:45)
   - Extend +15 menit looping kalau animal count > slot count

2. Group animals by preferensi:
   - Parse "Jam 07.00 sd.07.30" → bucket start = 07:00 (lihat parsePreferensiTime di §5.2)
   - Animals dengan preferensi → bucket sesuai jam (HH:MM key)
   - Sapi kolektif: ambil preferensi dari pengkurban PERTAMA yang isi form
     untuk sapi tersebut, atau preferensi EARLIEST kalau multiple
   - Animals tanpa preferensi (atau parse gagal) → bucket "FLEX"

3. Greedy assignment (per bucket, urut dari paling pagi):
   Untuk tiap animal di bucket jam HH:MM:
     - Cari slot kosong terdekat ke jam HH:MM (prefer slot ≥ HH:MM,
       kalau ga ada baru cari slot < HH:MM)
     - Assign animal ke slot itu (mark slot taken)
   Setelah semua bucket berjam selesai, place "FLEX" ke slot kosong
   urut dari paling pagi.

4. Overflow:
   Kalau slot habis sebelum semua animal masuk, extend grid +15 mnt
   loop sampai cukup. Track slot index pertama yang > 11:45 sebagai
   `overflow_start_slot`.

5. Persist:
   UPDATE animals SET
     scheduled_at = $1,
     scheduled_team = $2
   WHERE id = $3
   Wrap semua di transaction. Animal yang ga di-include (mis. status
   REJECTED) → scheduled_at di-set NULL (cleanup dari run sebelumnya).
```

### 5.1 Sapi kolektif: pengelompokan & preferensi

Schema (lihat `animals.service.ts:241-320` `generateFromRegistrations`):

- **Kolektif animals** (`animal_type` IN `SAPI_KOLEKTIF_A/B/C`): 1 `animal` row per `(event_id, animal_type)`, `pengkurban_id IS NULL`. Linkage ke sohibul = lewat match `pengkurban.event_id = animal.event_id AND pengkurban.animal_type = animal.animal_type AND pengkurban.status IN ('CONFIRMED','PENDING_VERIFICATION')`.
- **Individual animals** (DOMBA/KAMBING/SAPI_PERORANGAN): 1 animal per pengkurban, link langsung via `animal.pengkurban_id`.
- **Vendor animals** (`is_vendor_animal = true`): tidak ada sohibul. Masuk bucket FLEX, ga ada preferensi.

Untuk dapat preferensi sapi kolektif:
1. Query `pengkurban` matching `(event_id, animal_type)` di atas
2. Untuk tiap pengkurban, ambil form response `data["Preferensi waktu penyembelihan"]`
3. Parse semua valid preferensi → ambil **earliest** (jam paling pagi)
4. Kalau semua null / tidak ada match → animal masuk bucket FLEX

Untuk individual: ambil preferensi dari `pengkurban` ter-link langsung.

### 5.2 `parsePreferensiTime` (mapper utility)

```typescript
// Input contoh: "Jam 07.00 sd.07.30", "Jam 07.30 sd 08.00", "Jam 09.30 sd 10.00"
// Output: { hour: 7, minute: 30 } atau null
export function parsePreferensiTime(value: string | null | undefined): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = value.match(/Jam\s+(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
```

Test cases (di `scheduling-mappers.spec.ts`):
- `"Jam 07.00 sd.07.30"` → `{hour:7,minute:0}`
- `"Jam 07.30 sd 08.00"` → `{hour:7,minute:30}`
- `"Jam 12.00 sd 12.30"` → `{hour:12,minute:0}`
- `"jam invalid"` → `null`
- `""`, `null`, `undefined` → `null`
- `"Jam 25.00 sd 25.30"` → `null` (out of range)

### 5.3 Edge cases

| Case | Behavior |
|---|---|
| Sapi kolektif tanpa pengkurban (vendor, `pengkurban_id IS NULL`) | Bucket FLEX |
| Hewan baru ditambah setelah generate | Tidak otomatis ke-schedule. Admin klik "Generate Ulang" untuk overwrite |
| Form response baru update preferensi | Sama — tunggu regenerate manual |
| Animal `status='REJECTED'` atau pengkurban deleted | Skipped — `scheduled_at` di-reset NULL pada regenerate |
| Total animal = 0 | Return `{ summary: { sapi: 0, kambing: 0 }, slots: [] }`, ga error |
| Preferensi A & B sama persis (07:00), 1 slot 07:30 free | Greedy: A dapet 07:30, B dapet 07:45 (slot terdekat berikutnya) |
| Manual override sebelumnya hilang setelah regenerate | Sesuai keputusan (overwrite). Future: `scheduled_locked` flag |

### 5.4 Summary output (dari `POST /generate`)

```json
{
  "generated_at": "2026-06-05T21:30:00+07:00",
  "teams": {
    "SAPI": {
      "total": 8,
      "slots_used": 8,
      "overflow": 0,
      "first_slot": "07:30",
      "last_slot": "09:15"
    },
    "KAMBING_DOMBA": {
      "total": 22,
      "slots_used": 22,
      "overflow": 4,
      "first_slot": "07:30",
      "last_slot": "12:45"
    }
  },
  "mismatches": [
    {
      "animal_code": "ANM-1447H-A1B2C3D4",
      "pengkurban_name": "Margono",
      "preferred": "07:00",
      "scheduled": "07:45",
      "reason": "slot terdekat penuh"
    }
  ],
  "unscheduled_without_preferensi": [
    { "animal_code": "ANM-...", "pengkurban_name": "Didin" }
  ]
}
```

UI tampilin `mismatches` dan `unscheduled_without_preferensi` biar admin tau siapa yang preferensi-nya ga ke-honor atau ga isi form (bisa nudge lewat WA grup).

## 6. API Endpoints

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| `POST` | `/api/scheduling/generate` | SUPER_ADMIN, KETUA_PANITIA | `{ eventId }` | summary JSON (§5.4) |
| `GET` | `/api/scheduling` | authenticated (any role) | `?eventId=&team=SAPI\|KAMBING_DOMBA` | `[{ scheduledAt, scheduledTeam, animal: {...}, pengkurban: {...}, mismatch?: {...} }]` |
| `PATCH` | `/api/scheduling/:animalId` | SUPER_ADMIN, KETUA_PANITIA | `{ scheduledAt?, scheduledTeam?, scheduledNote? }` | updated row |
| `DELETE` | `/api/scheduling` | SUPER_ADMIN, KETUA_PANITIA | `{ eventId }` | `{ cleared: N }` |
| `GET` | `/api/scheduling/pdf` | SUPER_ADMIN, KETUA_PANITIA, PANITIA_VOUCHER | `?eventId=` | `application/pdf` stream |
| `POST` | `/api/scheduling/broadcast` | SUPER_ADMIN, KETUA_PANITIA | `{ eventId, target: 'sohibul_group'\|'panitia_group', dryRun? }` | `{ sent: bool, preview?: string, group_jid }` |
| `GET` | `/api/public/scheduling/me` | sohibul portal token (existing) | — | `[{ animalCode, animalType, scheduledAt, scheduledTeam }]` untuk hewan-hewan sohibul yang login |
| `GET` | `/api/scheduling/seset` | SUPER_ADMIN, KETUA_PANITIA, PANITIA_VOUCHER, PANITIA_SCANNER | `?eventId=&team=` | `[{ animal, slot, sohibulRequests: [{ name, hak, permintaanKhusus, catatanSebagian, catatanPanitia }] }]` |
| `GET` | `/api/scheduling/seset/pdf` | sama | `?eventId=` | `application/pdf` cheat sheet untuk tim jagal/seset |

## 7. UI

### 7.1 Admin — `client/jadwal.html`

Halaman baru, link dari sidebar `app.js` (item nav baru "Jadwal" 📅 di antara "Hewan" dan "Scan Kartu Hewan"). Visible untuk SUPER_ADMIN, KETUA_PANITIA, PANITIA_VOUCHER (yang terakhir read-only).

```
┌───────────────────────────────────────────────────────────────┐
│ Jadwal Penyembelihan — Event 1447H              [Event ▾]    │
├───────────────────────────────────────────────────────────────┤
│ [Generate Ulang]  [Export PDF]  [Broadcast WA ▾]              │
│                                                                │
│ Summary: SAPI 8/8  •  KAMBING/DOMBA 22/22 (overflow 4) ⚠      │
│ Last generate: 2026-06-05 21:30 WIB by Fajar                  │
├───────────────────────────────────────────────────────────────┤
│  Time   │ Tim SAPI                  │ Tim KAMBING/DOMBA       │
│ ────────┼───────────────────────────┼─────────────────────────│
│  07:30  │ Asep Jamaluddin (kolektif)│ Haris Permadi (perorgn) │
│         │ ANM-...A1B2  [edit]       │ ANM-...C3D4  [edit]     │
│  07:45  │ Margono (kolektif) ⚠ pref │ Hadi Yuda (perorangan)  │
│  08:00  │ — kosong —                │ Topik H. — Kambing #1   │
│  ...                                                           │
│  12:45  │                           │ Pramu I. ⚠ overflow     │
├───────────────────────────────────────────────────────────────┤
│ Mismatches (3) ⚠                                              │
│ • Margono — preferensi 07:00, dijadwalkan 07:45 (slot penuh)  │
│ • ...                                                          │
└───────────────────────────────────────────────────────────────┘
```

**Interaksi:**
- Klik nama animal di slot → modal Edit (dropdown jam 07:30-13:00, dropdown tim, textarea note)
- "Generate Ulang" → konfirmasi modal "akan overwrite jadwal existing" → POST /generate
- "Export PDF" → trigger download PDF
- "Broadcast WA ▾" dropdown: "Post ke grup sohibul" / "Post ke grup panitia"
  - Klik → modal preview pesan (call POST broadcast dengan `dryRun=true`)
  - Tombol "Kirim" di modal → POST tanpa dryRun → success toast

**Tech notes:**
- Vanilla HTML + Tailwind CDN (sesuai pattern existing client/)
- `api()` helper dari `client/js/app.js` (jangan prefix `/api/` manual — lihat lesson dari deploy skill)
- Polling tidak ada di Phase 1 — refresh on action only
- Mobile-friendly tapi optimized desktop (admin biasanya laptop)

### 7.2 Sohibul portal — extend `client/portal-dashboard.html`

Section baru di portal-dashboard, di atas list hewan existing:

```
┌────────────────────────────────────────────────┐
│ 📅 Jadwal Penyembelihan Anda                  │
├────────────────────────────────────────────────┤
│ Hewan: Sapi Kolektif (ANM-1447H-A1B2C3D4)     │
│ Jam:   08:30 WIB                              │
│ Tim:   Sapi (di tenda Tim Sapi)               │
│                                                │
│ ⏰ Mohon hadir minimal 15 menit sebelum.      │
│ 📞 Update via grup sohibul + portal ini.      │
└────────────────────────────────────────────────┘
```

Multiple cards kalau sohibul punya >1 hewan (mis. kambing + sapi kolektif). Kalau belum ke-schedule → "Jadwal belum di-generate panitia, mohon ditunggu."

Data source: `GET /api/public/scheduling/me` (auth pakai existing sohibul portal token mechanism).

## 8. WA Broadcast

**Approach:** wa-bot di-invite ke grup sohibul qurban + grup panitia. Bot post atas nama panitia (broadcast 1-to-many = 1 message per grup, bukan loop per nomor) untuk menghindari risk ban WhatsApp.

### 8.1 Pesan ke grup sohibul (`target='sohibul_group'`)

Template (di `scheduling-broadcast.service.ts`):

```
📋 *JADWAL PENYEMBELIHAN — 1447H*

Assalamualaikum bapak/ibu sohibul qurban,
Berikut jadwal penyembelihan Idul Adha:

*Tim SAPI* (8 hewan, mulai 07:30)
07:30 — Asep Jamaluddin
07:45 — Margono (kolektif: Margono, Andika, Sylvie...)
08:00 — ...
...

*Tim KAMBING/DOMBA* (22 hewan)
07:30 — Haris Permadi
07:45 — Hadi Yuda
...

📍 Halaman Masjid Al Hijrah CGE
⏰ Mohon hadir min. 15 menit sebelum slot Anda
🔗 Detail di portal: https://kurban.masjidalhijrahcge.id/portal.html

Jazakumullahu khairan,
Panitia Kurban
```

### 8.2 Pesan ke grup panitia (`target='panitia_group'`)

Format sama, plus footer warning untuk awareness:

```
[... isi sama ...]

_Generated 2026-06-05 21:30 WIB by Fajar_

⚠️ 4 hewan overflow di luar target 12:00
⚠️ 3 preferensi waktu tidak ter-honor (lihat dashboard)
```

### 8.3 Implementation

- `SchedulingBroadcastService.buildSohibulMessage(eventId): Promise<string>`
- `SchedulingBroadcastService.buildPanitiaMessage(eventId): Promise<string>`
- `SchedulingBroadcastService.sendToGroup(groupJid, message): Promise<void>`
  - Call wa-bot `/send` dengan body `{ jid: groupJid, message }` — assume `/send` accept group JID (Baileys format `<id>@g.us`). Verify saat implement; kalau wa-bot perlu endpoint baru, flag di plan.
- `dryRun=true` → return `{ preview: message, group_jid, sent: false }` tanpa send
- Env baru:
  - `WA_SOHIBUL_GROUP_JID` — wajib di prod sebelum fitur dipakai; kalau ga di-set, endpoint return 503 "grup belum dikonfigurasi"
  - `WA_PANITIA_GROUP_JID` — opsional, fallback ke `WA_NOTIFY_PHONE` (1-on-1 ke Fajar) kalau ga di-set

## 8.5 Daftar Permintaan Daging (Cheat Sheet Tim Jagal/Seset)

Tim jagal & seset butuh info dari form sohibul untuk tau apa yang diminta per hewan (potongan tertentu, kg, dll). Data sudah ada di `form-responses` (`konfirmasi_teknis_1447h`), tinggal di-extract + display.

### 8.5.1 Sumber data (form kolom)

Per pengkurban yang isi form, ambil:

| Kolom form | Field internal | Contoh isi |
|---|---|---|
| "Hak daging qurban untuk Sohibul Qurban" | `hak` | "Ambil Hak Paha Kanan untuk hewan qurban perorangan" |
| "Permintaan khusus untuk bagian tertentu untuk Sohibul Qurban" | `permintaanKhusus` | "Kaki", "Ekor", "Has Dalam", "Ekor, Lidah" |
| "Catatan pengambilan hak sebagian" | `catatanSebagian` | "Daging paha kanan 4kg, Has dalam 3 kg, tulang 3kg" |
| "Catatan Khusus untuk Panitia" | `catatanPanitia` | "Bagian has dalam bila memungkinkan" |

Mapper: `extractPermintaan(formData: Record<string, string>): Permintaan`. Test cases: full row, partial row, kolom kosong → empty string fields.

### 8.5.2 Output 1 — kolom "Permintaan" di PDF jadwal (Bagian 9)

Tambah 1 kolom singkat di PDF jadwal supaya tim jagal yang pegang jadwal langsung tau ada permintaan apa per slot. Format:

- Kalau ada ≥1 field non-empty → tampil **ringkas 1-baris** (truncate ~40 char): "Paha kanan + ekor"
- Kalau semua empty → "—"
- Kolektif: gabung permintaan semua sohibul, sambil prefix nama: "Asep:kaki / Margono:has dalam"
- Detail lengkap → lihat cheat sheet seset (Output 2)

### 8.5.3 Output 2 — cheat sheet detail `/seset.html` + PDF

Halaman terpisah untuk tim seset (yang motong/membagi daging). Format per-hewan, long-form.

**UI `client/seset.html`:**

```
┌─────────────────────────────────────────────────────────────┐
│ Cheat Sheet Seset — Event 1447H               [Event ▾]     │
│                                                              │
│ [Filter Tim ▾]  [Download PDF]                              │
├─────────────────────────────────────────────────────────────┤
│ 07:30 │ Tim SAPI │ ANM-1447H-A1B2C3D4 (kolektif)            │
│ ────────────────────────────────────────────────────────────│
│ Sohibul 1: Asep Jamaluddin                                  │
│   Hak: Ambil Hak ± 3 Kg untuk sapi kolektif                 │
│   Permintaan khusus: Kaki                                   │
│   Catatan: -                                                │
│   Catatan panitia: -                                        │
│ Sohibul 2: Margono                                          │
│   Hak: Ambil Hak ± 3 Kg untuk sapi kolektif                 │
│   ...                                                        │
│ ────────────────────────────────────────────────────────────│
│ 07:45 │ Tim SAPI │ ANM-...                                  │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

**PDF cheat sheet** (`GET /api/scheduling/seset/pdf`):
- A4 portrait, 1 hewan per "card" (block 1/3 halaman atau dinamis)
- Header: jam + tim + animal code
- Body: list sohibul → 4 baris (hak, permintaan khusus, catatan sebagian, catatan panitia)
- Pagination: kalau hewan banyak, lanjut halaman berikutnya
- Reuse pdfkit pattern dari Bagian 9

**Akses role:** SUPER_ADMIN, KETUA_PANITIA, PANITIA_VOUCHER, PANITIA_SCANNER (tim jagal/seset adalah scanner role).

### 8.5.4 Edge cases

- Vendor animal (no sohibul) → cheat sheet skip ATAU tampil "(vendor, tidak ada permintaan)"
- Sohibul belum isi form → tampil "(belum isi form konfirmasi)"
- Field kosong → tampil "—"

## 9. PDF Export

Reuse pattern dari `src/vouchers/vouchers.service.ts` (pdfkit).

- A4 landscape, 2 kolom: Tim SAPI | Tim KAMBING/DOMBA
- Header:
  - Logo event (kalau ada `events.logo_path`)
  - Title "Jadwal Penyembelihan Idul Adha 1447H"
  - Subtitle "Masjid Al Hijrah CGE — {tanggal event}"
- Footer:
  - Generated timestamp (WIB)
  - Page X of Y
- Tiap row slot:
  - Kolom 1: jam (bold, 14pt)
  - Kolom 2: nama pengkurban + label hewan (12pt)
  - Kolom 3 (small, italic): animal code
  - **Kolom 4 (italic 9pt): permintaan ringkas** (lihat §8.5.2 — truncate ~40 char)
- Overflow rows: background tipis kuning (warning)
- Multi-page kalau panjang

## 10. Testing

| Test file | Coverage |
|---|---|
| `scheduling-mappers.spec.ts` | `parsePreferensiTime`: format variants, invalid input |
| `scheduling.service.spec.ts` | Generator core: bucket parse, greedy assign, overflow, edge cases dari §5.3, sapi kolektif preferensi aggregation |
| `scheduling.controller.spec.ts` | Role guard enforcement (smoke), basic CRUD plumbing dengan service mocked |
| `scheduling-broadcast.service.spec.ts` | Template rendering, sapi kolektif name fan-out di grup post, dry-run path, env-missing error |
| `scheduling-pdf.service.spec.ts` | Smoke: generate PDF buffer non-empty, content includes expected strings (extract via pdf-parse atau cukup check buffer size) |
| `scheduling-permintaan.spec.ts` | `extractPermintaan` mapper: full form data, partial, empty, kolektif aggregation |
| `scheduling-seset-pdf.service.spec.ts` | Smoke cheat sheet PDF buffer non-empty |

**Manual / smoke (post-deploy ke prod):**
1. SSH/cPanel: pastikan migration §4 udah di-apply ke Neon
2. Login `/index.html` sebagai SUPER_ADMIN
3. Buka `/jadwal.html` → "Generate Ulang" → cek summary count match expected animal count
4. Klik 1 slot → edit modal, ubah jam, save → row update
5. "Export PDF" → file download, isi sesuai tabel di UI
6. "Broadcast WA ▾" → "Post ke grup sohibul" → modal preview muncul, content sesuai template
7. **Sebelum click "Kirim" di prod:** test ke nomor sendiri dulu (override `WA_SOHIBUL_GROUP_JID` ke `628xxx@s.whatsapp.net` di env test)
8. Buka `/portal.html` login sebagai sohibul test (nomor sendiri) → cek section "Jadwal Anda" muncul

## 11. Deployment

1. **Apply migration SQL** (§4) di Neon DB lewat psql / Neon console. Verify dengan `\d animals`.
2. **Build:** `npm run build` lokal, cek `dist/scheduling/` ada.
3. **Set env vars baru di cPanel** (Node.js App → Environment Variables):
   - `WA_SOHIBUL_GROUP_JID` (wajib sebelum broadcast dipakai)
   - `WA_PANITIA_GROUP_JID` (opsional)
4. **Deploy:** ikut [[kurban-deploy-pr]] skill workflow (entity change → boot lokal test dulu).
5. **Verify:** smoke checklist §10.

## 12. Open questions / hand-off ke Phase 2

- **Phase 2:** menambah `slaughter_status` (WAITING/IN_PROGRESS/DONE) + transition timestamps + operasional UI per tim + JIT reminder + live view antrian di portal. Spec sendiri.
- **Phase 3:** foto workflow terintegrasi (`POST /animals/:id/photo` sudah ada — Phase 3 tambah trigger point + tampil di portal).
- **Decision belum dibahas, mungkin perlu Phase 2:** apakah broadcast kedua dikirim H-1 18:00 reminder otomatis? Kalau iya, tambah cron `0 18 * * *` di Phase 2 (kalau Phase 1 cuma manual button cukup).

## 13. Risks

| Risk | Mitigation |
|---|---|
| wa-bot `/send` ga support group JID | Verify di implement step; kalau ga support, tambah `/send-group` endpoint di wa-bot (separate repo task) |
| Generator output kurang sesuai kondisi lapangan (mis. 15 mnt per sapi terlalu cepat) | UI manual override per slot — admin bisa rearrange sebelum hari-H |
| Sohibul belum buka portal jadi ga tau jadwal | Grup WA post = primary channel, portal = secondary |
| Migration SQL gagal di prod | Manual run sebelum deploy code; rollback dengan `DROP COLUMN scheduled_*` (data hilang OK karena baru) |
| `synchronize: true` di local dev nge-drop kolom yang ga ada di entity | Pastikan entity update + commit bareng migration SQL; review diff sebelum push |
