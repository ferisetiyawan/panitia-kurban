#!/usr/bin/env bash
# One-off: create portal_otp table for OTP login flow (PR sohibul-portal-otp).
# Idempotent - safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_HOST=$(grep ^DB_HOST= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_PORT=$(grep ^DB_PORT= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_USER=$(grep ^DB_USER= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_PASSWORD=$(grep ^DB_PASSWORD= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_NAME=$(grep ^DB_NAME= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)

echo "=== Apply portal_otp table to $DB_NAME @ $DB_HOST ==="

PGPASSWORD="$DB_PASSWORD" psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=require" <<'SQL'
CREATE TABLE IF NOT EXISTS portal_otp (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        varchar(20) NOT NULL,
  code_hash    varchar(128) NOT NULL,
  expires_at   timestamp NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_otp_phone ON portal_otp(phone);

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'portal_otp'
ORDER BY ordinal_position;
SQL

echo "=== Done ==="
