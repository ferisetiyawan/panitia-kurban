# Voucher Pickup Feature Design

**Date:** 2026-05-24  
**Status:** Approved, ready for implementation

---

## Background

Sistem voucher saat ini hanya punya dua status: `ACTIVE` → `CLAIMED`. Tidak ada pencatatan proses
pengambilan voucher oleh warga sebelum hari H distribusi daging.

Kebutuhan nyata: warga (sohibul qurban maupun warga umum per alamat) datang ke panitia untuk
mengambil voucher yang akan mereka distribusikan ke orang yang membutuhkan. Proses ini perlu
dicatat — siapa yang ambil, dari cluster mana, berapa voucher — dengan cara scan QR, bukan
pencatatan manual di Google Sheets.

**Konteks data saat ini:** 4 voucher di-scan saat testing, semua masuk `CLAIMED`. Yang benar:
2 voucher pertama seharusnya `DISTRIBUTED` ke Pak Agam (MGT 1/5), 2 sisanya kembali ke `ACTIVE`.
Data ini perlu dikoreksi manual setelah fitur selesai dibangun.

---

## Status Flow Baru

```
ACTIVE ──(pickup scan)──► DISTRIBUTED ──(hari H scan)──► CLAIMED
  │                                                          
  └──(hari H scan, tanpa pickup dulu)──────────────────────►┘
  
ACTIVE atau DISTRIBUTED ──(cancel)──► CANCELLED
```

- `ACTIVE` → `DISTRIBUTED`: via endpoint pickup scan baru
- `DISTRIBUTED` → `CLAIMED`: via endpoint scan existing (diupdate)
- `ACTIVE` → `CLAIMED`: tetap bisa (bypass pickup, untuk kasus langsung di hari H)

---

## Section 1: Data Model

### VoucherStatus enum
Tambah satu nilai baru:

```typescript
export enum VoucherStatus {
  ACTIVE = 'ACTIVE',
  DISTRIBUTED = 'DISTRIBUTED',  // ← baru
  CLAIMED = 'CLAIMED',
  CANCELLED = 'CANCELLED',
}
```

### Tabel `vouchers` — 5 kolom baru (semua nullable)

| Kolom | Tipe DB | TypeORM | Keterangan |
|---|---|---|---|
| `pickup_cluster` | varchar | `@Column({ nullable: true })` | Enum string: MARGATA / NAHARA / UENOS / LAINNYA |
| `pickup_unit` | varchar | `@Column({ nullable: true })` | Nomor unit, e.g. "1/5", "3/32" |
| `pickup_phone` | varchar | `@Column({ nullable: true })` | Nomor HP penerima (opsional) |
| `picked_up_at` | timestamp | `@Column({ nullable: true })` | Waktu pickup scan |
| `picked_up_by` | FK → users | `@ManyToOne(nullable: true)` | Panitia yang melakukan scan pickup |

Cluster disimpan sebagai varchar (bukan PostgreSQL enum) untuk kemudahan menambah nilai baru
tanpa migration DDL. Validasi di aplikasi layer.

### Tabel `scan_logs` — nilai `action` baru
Kolom `action` sudah bertipe text. Tambah nilai baru: `PICKUP`.

Nilai action yang ada:
- `CLAIMED` — scan hari H berhasil
- `REJECTED` — scan ditolak (sudah claimed/cancelled)
- `PICKUP` — scan pickup berhasil ← baru

---

## Section 2: API & Backend

### Endpoint baru: `POST /api/vouchers/scan-pickup`

**Auth:** JWT required, roles: `PANITIA_SCANNER`, `KETUA_PANITIA`, `SUPER_ADMIN`

**Request body:**
```json
{
  "voucherCode": "QRB-1447H-XXXXXXXXXX",
  "pickupCluster": "MARGATA",
  "pickupUnit": "1/5",
  "pickupPhone": "08123456789"
}
```

**Validasi:**
- `voucherCode` wajib
- `pickupCluster` wajib, nilai: `MARGATA` | `NAHARA` | `UENOS` | `LAINNYA`
- `pickupUnit` wajib
- `pickupPhone` opsional

**Logic:**
1. Cari voucher by code
2. Jika tidak ditemukan → 404
3. Jika status `DISTRIBUTED` → 400 "Voucher sudah diambil sebelumnya"
4. Jika status `CLAIMED` → 400 "Voucher sudah diklaim di hari H"
5. Jika status `CANCELLED` → 400 "Voucher sudah dibatalkan"
6. Update voucher: status `DISTRIBUTED`, isi 5 kolom pickup
7. Insert scan_log: action `PICKUP`, notes "Voucher berhasil diambil"
8. Return voucher + pesan sukses

**Response 200:**
```json
{
  "voucher": { "voucherCode": "...", "status": "DISTRIBUTED", "pickupCluster": "MARGATA", ... },
  "message": "Voucher berhasil dicatat sebagai sudah diambil"
}
```

---

### Update endpoint existing: `POST /api/vouchers/scan`

Perubahan minimal: voucher dengan status `DISTRIBUTED` kini juga bisa di-claim (tidak hanya `ACTIVE`).

Tambahan di response: jika voucher sebelumnya `DISTRIBUTED`, sertakan info pickup sebagai konteks:
```json
{
  "voucher": { ... },
  "message": "Voucher berhasil diklaim!",
  "pickupInfo": "Diambil oleh MARGATA 1/5 pada 24 Mei 2026"
}
```

---

### Update endpoint: `GET /api/vouchers/stats`

Tambah field `distributed` ke response:
```json
{
  "total": 100,
  "active": 40,
  "distributed": 35,
  "claimed": 20,
  "cancelled": 5
}
```

---

## Section 3: Frontend / Scanner UX

### Halaman baru: `client/scanner-pickup.html`

Terpisah dari `scanner.html` (scanner hari H) agar alur tidak tercampur.

**State 1 — Form penerima:**
```
┌─────────────────────────────────┐
│  🟡 SCANNER PICKUP KUPON        │
│  Catat pengambilan kupon        │
│─────────────────────────────────│
│  Cluster:  [ MARGATA        ▼ ] │
│  No. Unit: [ _______________  ] │
│  No. HP:   [ _______________ ] │
│            (opsional)           │
│                                 │
│       [ Mulai Sesi Pickup ]     │
└─────────────────────────────────┘
```

**State 2 — Sesi aktif (multi-scan):**
```
┌─────────────────────────────────┐
│  📍 MARGATA 1/5                 │
│  ─────────────────────          │
│  ✅ QRB-1447H-XXXX   13:34:07  │
│  ✅ QRB-1447H-YYYY   13:34:12  │
│  → 2 voucher diambil            │
│─────────────────────────────────│
│  📷 [kamera aktif, scan...]     │
│─────────────────────────────────│
│   [ Selesai / Ganti Penerima ]  │
└─────────────────────────────────┘
```

**Behavior detail:**
- Kamera tetap aktif setelah tiap scan sukses — siap scan berikutnya tanpa tap apapun
- Scan sukses: bunyi beep + voucher code muncul di list dengan timestamp
- Scan gagal (sudah DISTRIBUTED/CLAIMED/CANCELLED): bunyi error + pesan merah, kamera tetap aktif
- Tombol "Selesai / Ganti Penerima": reset state, kembali ke State 1
- Implementasi kamera: pakai library `html5-qrcode` yang sudah dipakai di `scanner.html`

**Navigasi:** Tambah link/tombol ke `scanner-pickup.html` dari halaman `scanner.html`

**Auth:** Cek JWT token saat load, redirect ke login jika tidak ada (sama seperti halaman admin lainnya)

---

## Section 4: Dampak ke Fitur yang Sudah Ada

### Voucher list (`vouchers.html`)
- Dropdown filter status: tambah opsi `DISTRIBUTED`
- Tabel: tambah kolom "Pickup" (cluster + unit, tampil hanya jika ada)
- Export CSV: tambah kolom `Cluster Pickup`, `Unit Pickup`, `No HP Pickup`, `Tgl Pickup`

### Dashboard (`dashboard.html`)
- Tambah tile "Sudah Diambil" (warna oranye/kuning) di antara tile Active dan Claimed
- Data dari stats endpoint

### Scanner hari H (`scanner.html`)
- Update logic: terima `ACTIVE` dan `DISTRIBUTED`, keduanya bisa di-claim
- Tampilkan pickup info sebagai konteks jika voucher sebelumnya `DISTRIBUTED`

### Tidak berubah
- PDF generation & batch create voucher
- Pengkurban & donasi flow
- Auth, roles, dan middleware
- Activity logs interceptor (otomatis log semua request)

---

## Data Correction (setelah implementasi selesai)

4 voucher yang di-scan saat testing perlu dikoreksi:

| Voucher | Action | Target status |
|---|---|---|
| voucher scan ke-1 (13:34:20) | Reset ke DISTRIBUTED, isi pickup Pak Agam | DISTRIBUTED |
| voucher scan ke-2 (13:34:12) | Reset ke DISTRIBUTED, isi pickup Pak Agam | DISTRIBUTED |
| voucher scan ke-3 (13:34:07) | Reset ke ACTIVE, hapus scan log | ACTIVE |
| voucher scan ke-4 (13:10:16) | Reset ke ACTIVE, hapus scan log | ACTIVE |

Script koreksi dijalankan langsung via psql setelah migrasi schema selesai.

---

## Cluster Reference

| Kode | Nama Cluster |
|---|---|
| MARGATA | Margata |
| NAHARA | Nahara |
| UENOS | Uenos |
| LAINNYA | Lainnya / Luar Cluster |
