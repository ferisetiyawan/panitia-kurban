# Feature spec: Auto-notify pengkurban via WhatsApp on registration (with log)

**Status:** idea / backlog — belum ada branch / PR.
**Diusulkan:** 2026-04-24 (sesi reconcile).
**Pitch-context:** waktu reconcile data Idul Adha 1447H ditemukan duplikat (Margono, Andika Bayu) karena panitia input manual via admin dashboard (berdasar bukti transfer pihak ketiga — Bu Vonda), lalu 2 hari kemudian orangnya self-register via form publik. Tidak ada yang tahu duanya dobel sampai di-reconcile manual.

## Problem

Dua jalur registrasi (admin input vs self-register) tidak saling inform. Ketika panitia input manual berdasar bukti transfer masuk, pengkurban bersangkutan **tidak tahu** kalau dia sudah tercatat → dia ikut daftar ulang via form → duplikat di DB, `SAPI_KOLEKTIF_A` jadi listing 5 tapi riil 3.

## Proposed solution

Setelah panitia simpan pendaftaran manual (status apapun — `PENDING_PAYMENT`, `PENDING_VERIFICATION`, `CONFIRMED`), panitia-kurban kirim notifikasi WhatsApp otomatis ke nomor pengkurban lewat wa-bot, dan log pengirimannya.

### Flow

1. Admin submit form pendaftaran manual di dashboard panitia-kurban.
2. Service `PengkurbanService.create()` (atau hook sesudahnya) mendeteksi `source = 'admin'` (perlu field baru atau inferred dari user role).
3. Kalau `source = 'admin'` dan `phone` valid:
   - POST ke wa-bot `/send` dengan template message (lihat di bawah).
   - Simpan record notifikasi ke tabel `notification_logs` (baru).
4. Kalau `/send` gagal (non-2xx, timeout), tetap save record dengan `status = 'FAILED'` + error — jangan gagalkan transaksi pendaftaran.

### Template message (draft)

```
Assalamualaikum Bapak/Ibu {name},

Panitia Kurban Masjid Al Hijrah CGE sudah mencatat pendaftaran kurban atas nama Anda:

• Tipe: {animal_type_label}
• Status: {status_label}
• No. registrasi: {registration_number}

{status_specific_instruction}

Kalau Anda belum pernah menghubungi panitia / tidak merasa daftar, mohon balas pesan ini supaya kami bisa klarifikasi dan menghindari duplikasi data.

Jazakumullahu khairan.

Panitia Kurban — DKM Al Hijrah CGE
```

`status_specific_instruction` contoh:
- `PENDING_PAYMENT` → "Mohon lakukan transfer ke rekening BSI 1210104479 a/n Masjid Al Hijrah CGE dan kirim bukti ke panitia."
- `PENDING_VERIFICATION` → "Bukti transfer sudah kami terima, sedang diverifikasi (1×24 jam)."
- `CONFIRMED` → "Pembayaran Anda sudah diverifikasi. Info teknis (hari potong, distribusi daging) akan menyusul."

### Schema baru

Tabel `notification_logs`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `pengkurban_id` | uuid fk | nullable — bisa dipakai untuk konteks lain nanti |
| `channel` | enum | `WHATSAPP` (reserved untuk SMS/email nanti) |
| `target` | varchar | nomor atau alamat tujuan |
| `template_key` | varchar | `pengkurban_registered_admin` dsb |
| `payload` | jsonb | body yang dikirim (full message) |
| `status` | enum | `PENDING`, `SENT`, `FAILED` |
| `response` | jsonb | response dari wa-bot |
| `error` | text | kalau failed |
| `created_at` | timestamptz | |
| `sent_at` | timestamptz | nullable |

Field baru di `pengkurban`:
- `source` enum — `PUBLIC_FORM` | `ADMIN_INPUT` (default `PUBLIC_FORM`). Inferred dari controller kalau ada auth context, atau explicit di admin form.

### wa-bot side

Sudah support `POST /send` dengan `x-api-key`. Tidak perlu perubahan server. Log pengiriman otomatis masuk `wa_messages` (outgoing) di DB wa-bot.

### Configuration

Env var baru di panitia-kurban:
- `WA_BOT_URL` = `https://wa-bot-production-fcfe.up.railway.app`
- `WA_BOT_API_KEY` = (baca dari wa-bot Railway env, atau local `wa-bot/.env`)
- `WA_BOT_ENABLED` = `true|false` — feature flag, default `false`.

Kalau `WA_BOT_ENABLED=false` atau URL kosong → skip call, tapi tetap save log dengan `status=PENDING` (untuk audit).

## Non-goals (sesi depan bisa tambah)

- Notifikasi update status (misal panitia approve → CONFIRMED otomatis notif). Bisa diturunkan dari event/observer setelah MVP jalan.
- 2-way flow (balasan "saya bukan saya" → flag data). Cukup manual review via `wa_messages` di wa-bot dulu.
- Batch reminder (H-1 pembagian, dsb).
- Template A/B / multi-language.

## Risiko / hal yang perlu diwaspadai

- **Nomor yang didaftarkan bisa milik pihak ketiga** (contoh case Bu Vonda: dia yang transfer untuk Margono & Andika, input pakai nomornya — pesan "atas nama Margono" nyasar ke Bu Vonda). Mitigation: tambahkan field "apakah nomor ini milik shohibul?" di admin form; kalau tidak, disclaim di message ("Pesan ini dikirim ke kontak yang didaftarkan panitia ...").
- **Rate limit WA**. Baileys kena throttle kalau burst. Tidak urgent untuk volume panitia-kurban (puluhan), tapi siapkan retry exponential.
- **Cloudflare Bot Fight Mode** — ini di panitia-kurban side ga kena (outgoing), cuma wa-bot → panitia-kurban yang sebaliknya bermasalah. Feature ini aman.

## Test plan

- Unit: service build template for each status.
- Integration: mock wa-bot `/send`, verify payload + log row.
- E2E: admin input → real WA kirim ke nomor dev (`628127149927`).
- Feature flag off → tidak ada call ke wa-bot, log row tetap ada status=PENDING.

## Follow-up untuk sesi berikutnya

1. Diskusi dengan mas Feri — feature ini di-merge ke upstream atau jadi fork-specific?
2. Apakah log WA mau nambah di sheet "log laporan whatsapp" juga, atau cukup di DB wa-bot?
3. Tentukan `source` dideteksi gimana (dari authenticated user role di JWT? atau explicit flag di endpoint admin vs publik?).
