# Deploy ke cPanel

Production: https://kurban.masjidalhijrahcge.id

Hosting: cPanel di shared VPS, Node.js app dikelola lewat cPanel "Setup Node.js App" (Passenger / cloudlinux-selector). Deploy **manual** via SSH + tar pipe — di-wrap di `scripts/cpanel-*.sh`.

> Host, username, dan kredensial **tidak** ditulis di repo. Lihat catatan internal panitia atau cPanel dashboard kamu.

## Prerequisite

1. **SSH access** ke cPanel server:
   - Generate keypair di lokal kalau belum ada (`ssh-keygen -t ed25519`)
   - Import public key di cPanel → **SSH Access** → **Manage SSH Keys** → **Import Key**
   - **Authorize key** setelah import (klik "Manage" → "Authorize"). Tanpa langkah ini key ga jalan walau sudah ke-import.
2. Akses ke cPanel **Setup Node.js App** (buat lihat virtualenv path & restart app).
3. Lokal: Node 20, `npm ci` sudah jalan, build sukses.

## Struktur app di server

```
~/public_html/kurban.masjidalhijrahcge.id/
├── dist/                  # compiled NestJS (replace tiap deploy)
├── client/                # static HTML/JS (replace tiap deploy)
├── public/                # asset publik
├── node_modules           # → symlink ke nodevenv (JANGAN ditimpa)
├── package.json
├── package-lock.json
├── uploads/               # runtime data — JANGAN ditimpa
├── tmp/                   # passenger restart trigger
├── stderr.log             # runtime errors
└── .htaccess              # Apache → Node app
```

## Quick reference

```bash
# Set sekali per shell session
export CPANEL_HOST=<host>        # cek dashboard cPanel
export CPANEL_USER=<user>        # "Current User" di sidebar cPanel
# REMOTE_PATH default = public_html/kurban.masjidalhijrahcge.id

# Build & deploy
git checkout master && git pull origin master
npm ci                                # only if package-lock.json changed
npm run build
./scripts/cpanel-deploy.sh            # full: dist + client + restart
./scripts/cpanel-verify.sh            # smoke test

# Partial: frontend-only
./scripts/cpanel-deploy.sh --client --restart

# Just bounce app:
./scripts/cpanel-restart.sh

# Preview without execute:
./scripts/cpanel-deploy.sh --dry-run
```

Lihat `scripts/README.md` untuk detail flag per script.

---

## Detailed flow

### 1. Build lokal

```bash
git checkout master
git pull origin master
npm ci
npm run build
```

Output deploy: `dist/`, `client/`, `package.json`, `package-lock.json`.

### 2. Set env vars

Jangan commit nilai ini. Set per shell session:

```bash
export CPANEL_HOST=<host>
export CPANEL_USER=<user>
```

### 3. Deploy

```bash
# Default (full): dist + client + restart
./scripts/cpanel-deploy.sh

# Pick what to upload (flags combinable)
./scripts/cpanel-deploy.sh --dist
./scripts/cpanel-deploy.sh --client --restart
./scripts/cpanel-deploy.sh --dist --restart   # backend-only change
```

Script pakai **atomic swap** — upload ke `<target>.tmp` dulu, terus `mv` ke production folder. Kalau tar mid-transfer gagal, app tetep jalan dengan code lama. Old folder di-cleanup setelah swap sukses.

**Yang TIDAK boleh ke-upload:**
- `uploads/` — runtime data (bukti transfer, logo) — script ga touching folder ini
- `node_modules` — symlink server, beda dengan lokal
- `.env` — secret production beda (env vars di-set via cPanel UI)
- `tmp/`, `stderr.log` — runtime files server

### 4. Install deps (kalau berubah)

Kalau `package.json` / `package-lock.json` ga berubah, skip.

**Via cPanel UI (paling gampang):**
- Buka **Setup Node.js App** → app entry kurban → klik **Run NPM Install**

**Via SSH:**

```bash
ssh "$CPANEL_USER@$CPANEL_HOST" <<'EOF'
source ~/nodevenv/public_html/kurban.masjidalhijrahcge.id/20/bin/activate
cd ~/public_html/kurban.masjidalhijrahcge.id
npm install --production
EOF
```

*(Path `nodevenv/.../20/bin/activate` tepatnya muncul di cPanel "Setup Node.js App" → kolom "Enter to the virtual environment".)*

### 5. Restart

`cpanel-deploy.sh --restart` udah trigger ini. Kalau perlu manual:

```bash
./scripts/cpanel-restart.sh
```

Atau cPanel UI: **Setup Node.js App** → klik **Restart**.

### 6. Verifikasi

```bash
./scripts/cpanel-verify.sh                  # smoke test endpoints
SHOW_STDERR=1 ./scripts/cpanel-verify.sh    # juga tail stderr.log via SSH
```

## Rollback

```bash
# Build dari commit sebelumnya
git checkout <commit-sha-sebelumnya>
npm ci
npm run build
./scripts/cpanel-deploy.sh
```

Atau revert + push ulang:

```bash
git revert <commit-sha>
git push origin master
npm run build && ./scripts/cpanel-deploy.sh
```

## Catatan penting

- **Build di server ga tersedia.** `npm run build` harus sukses lokal sebelum upload.
- **DB schema auto-sync** (`synchronize: true` di TypeORM). Hati-hati kalau ada rename kolom — lihat case "Migration yang pernah kehilangan data" di `CLAUDE.md` (commit `113a80e`).
- **Env vars** (`DATABASE_URL`, `JWT_SECRET`, `WA_BOT_URL`, dll) di-set sekali via cPanel "Setup Node.js App" → "Environment Variables". Tidak ada `.env` file di server.
- **`uploads/`** isi-nya kritis (bukti transfer pengkurban + donasi). Backup berkala via cPanel "Backup". Script deploy ga touching folder ini.
- Format perubahan code yang akan masuk PR ke upstream: tetap dari branch feature → PR ke `ferisetiyawan/panitia-kurban`. Master di `fajarmf/panitia-kurban` boleh ahead untuk deploy production (izin sudah dari maintainer).

## Future: GitHub Actions

Sketsa workflow yang replace prosedur manual:

1. Repo secret: `CPANEL_HOST`, `CPANEL_USER`, `CPANEL_SSH_KEY` (private key).
2. Trigger: push ke `master` atau manual `workflow_dispatch`.
3. Steps:
   - `npm ci && npm run build`
   - Setup ssh-agent dengan secret
   - `./scripts/cpanel-deploy.sh` (script udah modular, langsung pake)
   - `./scripts/cpanel-verify.sh` smoke test (assert 200)

Belum di-implement. Tambah `.github/workflows/deploy.yml` kalau sudah siap pindah dari manual.
