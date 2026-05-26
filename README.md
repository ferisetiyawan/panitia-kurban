# 🐄 Panitia Kurban — Masjid Al Hijrah CGE

Aplikasi full-stack manajemen panitia kurban: registrasi pengkurban, donasi, voucher QR, dan distribusi daging.

**Production:** https://kurban.masjidalhijrahcge.id

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Backend | NestJS 10 (TypeScript) |
| Database | PostgreSQL (Neon) |
| ORM | TypeORM (`synchronize: true`) |
| Auth | JWT + Passport |
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS |
| QR/PDF | `qrcode` + `pdfkit` + `html5-qrcode` |
| Realtime | Socket.io (WebSocket) |
| Notifikasi | WhatsApp via wa-bot |

## Cara Menjalankan

```bash
# 1. Install dependencies
npm install

# 2. Buat file .env (lihat bagian Environment Variables)

# 3. Jalankan development server
npm run start:dev

# 4. Buka di browser
open http://localhost:3000
```

> Saat pertama kali jalan, otomatis membuat akun Super Admin.

### Default Login

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Super Admin |

## Environment Variables

Buat file `.env` di root project:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# Atau gunakan variabel terpisah:
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=admin
DB_PASSWORD=admin123
DB_NAME=panitia_kurban

JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
PORT=3000
UPLOAD_DIR=./uploads
NODE_ENV=development

# WhatsApp notifier (opsional)
WA_BOT_URL=https://wa-bot.up.railway.app
WA_BOT_API_KEY=your-api-key
WA_NOTIFY_PHONE=628xxxxxxxxxx
```

## Scripts

```bash
npm run start:dev    # Development dengan watch mode
npm run build        # Compile TypeScript → JavaScript
npm run start:prod   # Jalankan production build
npm run lint         # ESLint fix
npm run test         # Unit tests
npm run test:cov     # Test coverage
```

## Role & Permission

| Role | Voucher | Scan | User | Pengkurban | Event | Dashboard |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Super Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ketua Panitia | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Panitia Voucher | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Panitia Scanner | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |

## Fitur

### Pengkurban (Sohibul Qurban)
- Registrasi publik dengan nomor registrasi otomatis (`REG-YYYY-NNNN`)
- Jenis hewan: Domba, Kambing, Sapi Kolektif (A/B/C), Sapi Perorangan
- Flow status: `PENDING_PAYMENT` → `PENDING_VERIFICATION` → `CONFIRMED` / `REJECTED`
- Upload bukti pembayaran
- Cek status mandiri via nomor HP atau registrasi
- Notifikasi WhatsApp otomatis saat daftar
- Rekap pesan siap-kirim ke WhatsApp

### Donasi / Sumbangan
- Form donasi publik dengan upload bukti transfer (opsional)
- Flow verifikasi oleh admin
- Statistik total donasi
- Notifikasi WhatsApp saat submit

### Voucher & Distribusi Daging
Generate dan kelola voucher QR untuk distribusi daging kurban.

**Flow status 3 tahap:**

```
ACTIVE → DISTRIBUTED (pickup) → CLAIMED (hari H)
```

- **ACTIVE** — voucher baru dibuat
- **DISTRIBUTED** — sudah diambil warga sebelum hari H (dicatat siapa, cluster mana)
- **CLAIMED** — di-scan saat distribusi daging hari H

Fitur voucher:
- Kode unik format `QRB-{hijriYear}H-{random10}`
- Batch create hingga 500 voucher sekaligus
- Download PDF: 5 kupon/halaman dengan QR code + logo event
- Filter, search, bulk delete, bulk update tanggal distribusi
- Export CSV lengkap termasuk data pickup

### Scanner Pickup (Sebelum Hari H)
Catat pengambilan voucher oleh warga sebelum hari H.

- Buka `scanner-pickup.html`
- Input penerima sekali: pilih cluster (Margata/Nahara/Uenos/Lainnya) + nomor unit + HP (opsional)
- Scan beberapa voucher dalam satu sesi — semua otomatis tercatat ke penerima yang sama
- Counter voucher per sesi

### Scanner Hari H
Klaim voucher saat distribusi daging.

- Scan QR via kamera HP, terima voucher `ACTIVE` maupun `DISTRIBUTED`
- Jika voucher sudah di-pickup, tampilkan info pengambilan sebelumnya
- Input manual sebagai fallback
- **Offline mode**: simpan scan ke localStorage, sync otomatis saat koneksi kembali

### Dashboard
- Statistik real-time: total, sudah diambil, diklaim, pengkurban, donasi
- Progress bar persentase klaim hari H
- Riwayat scan terbaru
- Live update via WebSocket saat voucher diklaim

### Form Konfirmasi Teknis
- Sync dari Google Forms/Sheets ke database
- Data: preferensi penyembelihan, jumlah kupon yang dibutuhkan, mandat qurban
- Terhubung ke data pengkurban via nomor registrasi

### Analytics & Audit
- Tracking page visit publik (visitor funnel)
- Activity log otomatis untuk semua request admin

## Struktur Direktori

```
panitia-kurban/
├── client/                    # Frontend (served via NestJS ServeStaticModule)
│   ├── css/style.css          # Glassmorphism theme
│   ├── js/app.js              # Shared utilities (API, auth, nav)
│   ├── index.html / login.html
│   ├── dashboard.html         # Dashboard + statistik
│   ├── users.html             # Manajemen user
│   ├── events.html            # Manajemen event + logo
│   ├── pengkurban.html        # Data pengkurban + rekap WA
│   ├── donations.html         # Data donasi
│   ├── vouchers.html          # Voucher CRUD + PDF + export
│   ├── scanner.html           # QR Scanner hari H
│   ├── scanner-pickup.html    # QR Scanner pickup (sebelum hari H)
│   ├── daftar.html            # Publik: daftar pengkurban
│   ├── status.html            # Publik: cek status + upload bukti
│   └── donate.html            # Publik: form donasi
├── src/                       # Backend NestJS
│   ├── auth/                  # JWT + Role guard
│   ├── users/                 # CRUD users
│   ├── events/                # CRUD events + logo upload
│   ├── pengkurban/            # CRUD pengkurban
│   ├── vouchers/              # Voucher + QR + PDF + scan + pickup
│   ├── donations/             # Donasi
│   ├── form-responses/        # Sync konfirmasi teknis dari Google Sheets
│   ├── dashboard/             # Statistik agregat
│   ├── analytics/             # Page visit tracking
│   ├── activity-logs/         # Audit log interceptor
│   ├── common/                # Enums, guards, notifications
│   └── seed/                  # Auto-seed Super Admin
└── uploads/                   # File uploads (logo, bukti pembayaran)
```

## Git Workflow

```
upstream (ferisetiyawan/panitia-kurban)  ← PR target
origin   (fajarmf/panitia-kurban)        ← fork Fajar
```

Branch pattern: `feat/<slug>` → push ke `origin` → PR ke `upstream`
