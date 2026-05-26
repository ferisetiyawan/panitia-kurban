#!/usr/bin/env bash
# One-off: fill shohibul_name kosong dengan nama pendaftar.
# Untuk 6 row CONFIRMED yg shohibul_name NULL/empty (cek dari audit 2026-05-25).
# Idempotent — re-run aman (cuma update yg masih kosong).
set -euo pipefail

cd "$(dirname "$0")/.."

DB_HOST=$(grep ^DB_HOST= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_PORT=$(grep ^DB_PORT= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_USER=$(grep ^DB_USER= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_PASSWORD=$(grep ^DB_PASSWORD= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_NAME=$(grep ^DB_NAME= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)

PGPASSWORD="$DB_PASSWORD" psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=require" <<'SQL'
BEGIN;

UPDATE pengkurban
SET shohibul_name = name
WHERE deleted_at IS NULL
  AND status = 'CONFIRMED'
  AND (shohibul_name IS NULL OR trim(shohibul_name) = '');

SELECT registration_number, name, shohibul_name, animal_type
FROM pengkurban
WHERE registration_number IN (
  'REG-2026-0050','REG-2026-0015','REG-2026-0052',
  'REG-2026-0014','REG-2026-0016','REG-2026-0055'
)
ORDER BY registration_number;

COMMIT;
SQL
