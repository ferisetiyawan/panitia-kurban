# scripts/

Modular ops scripts for panitia-kurban. All sensitive values (host, user, paths) come from env vars — **never hardcoded**.

## Setup (per shell session)

```bash
export CPANEL_HOST=<host>           # cek dashboard cPanel
export CPANEL_USER=<user>           # cek "Current User" di sidebar cPanel
export REMOTE_PATH=public_html/kurban.masjidalhijrahcge.id  # default kalau tidak di-set
```

## Scripts

| Script | Purpose |
|---|---|
| `cpanel-deploy.sh` | Upload `dist/` + `client/` ke cPanel via tar pipe (atomic swap), trigger Passenger restart |
| `cpanel-restart.sh` | Trigger Passenger restart aja (touch `tmp/restart.txt`) |
| `cpanel-verify.sh` | Smoke-test deployed endpoints (curl public pages + pricing API) |

Run with `--help` untuk flag detail.

## Standard deploy flow

```bash
git pull origin master
npm ci          # only if package-lock.json changed
npm run build
./scripts/cpanel-deploy.sh         # full: dist + client + restart
./scripts/cpanel-verify.sh         # smoke check
```

## Partial deploys

```bash
# Frontend-only change (HTML/JS):
./scripts/cpanel-deploy.sh --client --restart

# Backend-only change:
./scripts/cpanel-deploy.sh --dist --restart

# Just bounce the app (no upload):
./scripts/cpanel-restart.sh
```

## Dry run

Preview commands without execute:

```bash
./scripts/cpanel-deploy.sh --client --dry-run
```
