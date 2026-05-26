# panitia-kurban

Full-stack aplikasi manajemen panitia kurban Masjid Al Hijrah CGE — registrasi pengkurban, donasi, voucher QR, dan distribusi daging.

## Deployment

- **Production:** https://kurban.masjidalhijrahcge.id
- **Self-hosted** (bukan Railway/Vercel) — detail server di tangan panitia
- **Database:** Neon PostgreSQL (`neondb`, shared dengan wa-bot). Host & kredensial simpan di env lokal / secret manager, jangan di-commit.

## Stack

| Layer | Tech |
|---|---|
| Backend | NestJS 10 (TypeScript) |
| DB | PostgreSQL (Neon) via TypeORM, `synchronize: true` (auto-sync schema) |
| Auth | JWT (Passport) |
| Uploads | Multer memory storage → file di `./uploads/{payment-proofs,donation-proofs,logos}/` |
| Frontend | Vanilla HTML + Tailwind (CDN) + vanilla JS, di-serve oleh NestJS `ServeStaticModule` |
| PDF/QR | `pdfkit` + `qrcode` + `html5-qrcode` (scan di browser) |

## Git Remotes

| Remote | Repo | Fungsi |
|---|---|---|
| `upstream` | `ferisetiyawan/panitia-kurban` | Main repo (Mas Feri) — tempat PR di-merge |
| `origin` | `fajarmf/panitia-kurban` | Fork Fajar — tempat push feature branch sebelum PR |

**Workflow:** branch dari `upstream/master`, push ke `origin`, PR ke `upstream`. Lihat `gh pr list` untuk status.

## Environment Variables

```env
DB_HOST=<neon host>
DB_PORT=5432
DB_USERNAME=neondb_owner
DB_PASSWORD=<secret>
DB_NAME=neondb
DATABASE_URL=<postgres://... full url, override DB_HOST dll>

JWT_SECRET=<secret>
JWT_EXPIRES_IN=7d
PORT=3000
UPLOAD_DIR=./uploads
NODE_ENV=production

# WA notifier (opsional — skip silent kalau kosong)
WA_BOT_URL=https://wa-bot-production-fcfe.up.railway.app
WA_BOT_API_KEY=<di env>
WA_NOTIFY_PHONE=<nomor WA panitia, di env>
```

## Modul & Fitur

### 1. Auth (`src/auth`)
JWT bearer + role-based guard. Roles: `SUPER_ADMIN`, `KETUA_PANITIA`, `PANITIA_VOUCHER`, `PANITIA_SCANNER`.

### 2. Users (`src/users`)
CRUD panitia (admin only). Soft delete (`@Delete`) + hard delete (`@Delete :id/hard`).

### 3. Events (`src/events`)
Event kurban per tahun (logo upload, tahun Hijri, status aktif).

### 4. Pengkurban (`src/pengkurban`)
Registrasi orang yang mau kurban. Flow: `PENDING_PAYMENT` → (upload bukti) → `PENDING_VERIFICATION` → (admin verify) → `CONFIRMED` / `REJECTED`.

- **Registration number:** `REG-${year}-${NNNN}` — monotonic (MAX+1 with `withDeleted`), **tidak pernah reuse** walau row di-delete
- **Soft delete** via `@DeleteDateColumn` — `deleted_at` di-set, row tetap di DB
- **WA notifier** fire saat public register sukses

Animal types: `DOMBA`, `KAMBING`, `SAPI_KOLEKTIF_A`, `SAPI_KOLEKTIF_B`, `SAPI_KOLEKTIF_C` (spec sama dengan B — informal grouping label dari grup WA), `SAPI_PERORANGAN` (legacy: `SAPI_KOLEKTIF`).
Purchase types: `BELI_MASJID`, `BAWA_SENDIRI`.

### 5. Donations / Sumbangan (`src/donations`)
Donasi seikhlasnya. Flow: `PENDING_VERIFICATION` → `CONFIRMED` / `REJECTED`.

- Soft delete sama seperti pengkurban
- WA notifier fire saat public donate sukses

### 6. Vouchers (`src/vouchers`)
Voucher QR untuk distribusi daging. Batch create (up to 500), PDF download dengan logo event, scan via kamera HP.

### 7. Dashboard (`src/dashboard`)
Statistik agregat: pengkurban per animal type, voucher claimed, donations total.

### 8. Analytics (`src/analytics`)
Visitor tracking & funnel (page visits). Endpoint public `/api/public/track` (tidak perlu auth).

### 9. Activity Logs (`src/activity-logs`)
Interceptor global — log semua request ke `activity_logs` table. Schema: `(id, user_id, action, details, created_at)`.

### 10. Notifications (`src/common/notifications`)
`WaNotifierService` — fire-and-forget POST ke wa-bot `/send`. Global module, inject di service manapun yang butuh notif WA.

## API Endpoints

### Public (no auth)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/public/register` | Daftar pengkurban |
| POST | `/api/public/register/:id/payment-proof` | Upload bukti transfer (multipart, field `paymentProof`) |
| GET | `/api/public/register/:id` | Status by ID |
| GET | `/api/public/register/by-phone/:phone` | Status by nomor HP |
| GET | `/api/public/pricing` | Daftar harga hewan + rekening |
| POST | `/api/public/donate` | Submit donasi (multipart, opsional `paymentProof`) |
| GET | `/api/public/donate/:id` | Status donasi |
| POST | `/api/public/track` | Track page visit |

### Admin (JWT required)

| Method | Path | Role |
|---|---|---|
| POST | `/api/auth/login` | — |
| POST | `/api/auth/forgot-password` | — |
| POST | `/api/auth/reset-password` | — |
| GET | `/api/auth/profile` | authenticated |
| GET/POST/PATCH/DELETE | `/api/users` | SUPER_ADMIN |
| GET | `/api/events` | authenticated |
| POST/PATCH/DELETE | `/api/events` | SUPER_ADMIN / KETUA |
| POST | `/api/events/:id/logo` | SUPER_ADMIN / KETUA |
| GET | `/api/pengkurban` | SUPER_ADMIN / KETUA / PANITIA_VOUCHER |
| GET | `/api/pengkurban/export` | SUPER_ADMIN / KETUA / PANITIA_VOUCHER |
| POST/PATCH/DELETE | `/api/pengkurban` | SUPER_ADMIN / KETUA / PANITIA_VOUCHER |
| PATCH | `/api/pengkurban/:id/verify` | SUPER_ADMIN / KETUA |
| GET | `/api/donations` | SUPER_ADMIN / KETUA / PANITIA_VOUCHER |
| PATCH | `/api/donations/:id/verify` | SUPER_ADMIN / KETUA |
| DELETE | `/api/donations/:id` | SUPER_ADMIN / KETUA / PANITIA_VOUCHER |
| GET | `/api/vouchers` / `/export` / `/stats` | berbagai, lihat controller |
| POST | `/api/vouchers/batch` | SUPER_ADMIN / KETUA / PANITIA_VOUCHER |
| POST | `/api/vouchers/scan` | SUPER_ADMIN / KETUA / PANITIA_SCANNER |
| GET | `/api/dashboard/stats` | authenticated |
| GET | `/api/analytics/stats` | SUPER_ADMIN / KETUA |
| GET | `/api/activity-logs` | SUPER_ADMIN / KETUA |

### Static files

- `/api/uploads/payment-proofs/<filename>` — bukti transfer pengkurban
- `/api/uploads/donation-proofs/<filename>` — bukti transfer donasi
- `/api/uploads/logos/<filename>` — logo event

## Frontend (client/)

Vanilla HTML, no build step. Served dari `/` (static).

| File | Halaman |
|---|---|
| `index.html` | Login admin |
| `dashboard.html` | Statistik |
| `users.html` | CRUD panitia (SUPER_ADMIN) |
| `events.html` | CRUD event + upload logo |
| `pengkurban.html` | Admin pengkurban + verify + **Rekap WA** |
| `donations.html` | Admin donasi + verify + **Rekap WA** |
| `vouchers.html` | CRUD voucher + PDF |
| `scanner.html` | QR scanner (kamera HP) |
| `daftar.html` | Public: daftar pengkurban |
| `status.html` | Public: cek status + upload bukti mandiri |
| `donate.html` | Public: submit donasi |

## Database

### Tables utama

- `users` — panitia
- `events` — event kurban per tahun
- `pengkurban` — pendaftar kurban (soft-deletable)
- `donations` — donasi (soft-deletable)
- `vouchers` — voucher QR
- `scan_logs` — log scan voucher
- `activity_logs` — audit log semua request
- `page_visits` — analytics tracking

### Shared dengan wa-bot

DB yang sama juga dipakai `wa-bot` (table `wa_session`, `wa_messages`). Koordinasi schema: jangan conflict nama.

## Known Issues / History

### Migration yang pernah kehilangan data (Apr 22, 2026)

Commit `113a80e` rename `payment_proof_path` (string) → `payment_proof_paths` (simple-json array). TypeORM auto-sync **drop kolom lama**, bikin kolom baru kosong — **semua data path existing hilang**. File di disk masih ada.

**Recovery pattern:** file pre-migration pakai nama `REG-${reg}${ext}`. Cek di server, terus UPDATE DB `payment_proof_paths = '["uploads/payment-proofs/<filename>"]'`.

**Lesson:** kalau rename column non-trivial, stop pakai `synchronize: true` dan tulis migration manual yang COPY data lama.

## Build & Run

```bash
npm install
npm run start:dev   # watch mode
npm run build       # compile ke dist/
npm run start:prod  # run dist/main.js

npm run lint
npm run format
npm run test
```

## WhatsApp Notifier Integration

Service: `src/common/notifications/wa-notifier.service.ts` → POST ke wa-bot Railway `/send` endpoint.

**Trigger:**
- Public register pengkurban → notif ke `WA_NOTIFY_PHONE`
- Public submit donasi → notif ke `WA_NOTIFY_PHONE`

**Behavior:**
- Fire-and-forget (non-blocking)
- Error di-log, registrasi tetap sukses
- Skip silent kalau env `WA_BOT_URL` / `WA_BOT_API_KEY` / `WA_NOTIFY_PHONE` belum di-set

## Convention

- **Tidak ada Co-Authored-By trailer** di commit/PR (preference user).
- **Branch pattern:** `feat/<slug>` dari `upstream/master`, push ke `origin`, PR ke `upstream`.
- **Commit message:** Indonesia/English mix OK, lihat `git log` untuk gaya.
