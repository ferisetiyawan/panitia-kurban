#!/usr/bin/env bash
# One-off: cleanup shohibul_name format sebelum print kartu hewan.
# Decisions dari bos Fajar 2026-05-25:
#   REG-2026-0019 (Sary)   → hapus baris 1 "Kurban sapi 1 untuk 7 orang"
#   REG-2026-0048 (Anwar)  → strip numbering "N. "
#   REG-2026-0051 (Juwita) → cleanup numbering "N. "
#   REG-2026-0032 (Haris)  → "Kel" → "Keluarga"
#   REG-2026-0020 (Didin)  → biarin (no change)
#   REG-2026-0037 (BPKH)   → biarin (no change)
#   REG-2026-0033/35 (Topik) → tunggu konfirmasi via WA (no change)
set -euo pipefail

cd "$(dirname "$0")/.."

DB_HOST=$(grep ^DB_HOST= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_PORT=$(grep ^DB_PORT= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_USER=$(grep ^DB_USER= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_PASSWORD=$(grep ^DB_PASSWORD= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)
DB_NAME=$(grep ^DB_NAME= /Users/fajarfirdaus/Development/wa-bot/.env | cut -d= -f2-)

PSQL=(env PGPASSWORD="$DB_PASSWORD" psql "host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=require")

echo "=== Cleanup shohibul_name di $DB_NAME ==="
echo ""

"${PSQL[@]}" <<'SQL'
BEGIN;

-- REG-2026-0019 (Sary): hapus baris 1 "Kurban sapi 1 untuk 7 orang"
UPDATE pengkurban SET shohibul_name = E'1 Ati suryani binti mangsur\n2 Sary Hirmayani binti Didi Rochadi\n3 Rany Susiana binti Didi Rochadi\n4 Adiem Tricahyandi bin Didi Rochadi\n5 Suhendar bin Tau\n6 Rifkia Saida binti Ramlan\n7 Mukdir bin mangsur'
WHERE registration_number = 'REG-2026-0019';

-- REG-2026-0048 (Anwar): strip "N. " numbering prefix
UPDATE pengkurban SET shohibul_name = E'(Moh. Noer bin Muhamad Soleh) dan Keluarga\n(Liliek Soeprijadi bin RM. Soewarto Wonoboyo) dan Keluarga\n(Anwar Maulana bin Moh. Noer) dan Keluarga\n(Anwar Maulana bin Moh. Noer) dan Keluarga\n(Anwar Maulana bin Moh. Noer) dan Keluarga\n(Anwar Maulana bin Moh. Noer) dan Keluarga\n(Anwar Maulana bin Moh. Noer) dan Keluarga'
WHERE registration_number = 'REG-2026-0048';

-- REG-2026-0051 (Juwita): strip "N. " numbering, keep relationship labels & Almarhum
UPDATE pengkurban SET shohibul_name = E'Juwita Setyarini Soetrisno bin Alm. Soetrisno Kasmoen\nLenny Jacinta Sangi (Ibu)\nAlmarhum Soetrisno Kasmoen (Ayah)\nAlmarhumah Katini (Nenek)\nAlmarhum Kasmoen (Kakek)\nAlmarhum Suparjan Sutarno\nAlmarhumah Netty Prayitno'
WHERE registration_number = 'REG-2026-0051';

-- REG-2026-0032 (Haris): "Kel" → "Keluarga"
UPDATE pengkurban SET shohibul_name = 'Haris Permadi dan Keluarga'
WHERE registration_number = 'REG-2026-0032';

-- Show updated rows
SELECT registration_number, name, shohibul_name
FROM pengkurban
WHERE registration_number IN ('REG-2026-0019','REG-2026-0048','REG-2026-0051','REG-2026-0032')
ORDER BY registration_number;

COMMIT;
SQL

echo ""
echo "=== Done. Re-run audit to verify: node scripts/audit-shohibul-names.js ==="
