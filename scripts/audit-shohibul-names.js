#!/usr/bin/env node
// Audit nama sohibul sebelum print kartu hewan.
// Flag anomalies: kosong, jumlah ga match animal type, format suspicious.
//
// Usage:
//   node scripts/audit-shohibul-names.js                # all CONFIRMED active
//   node scripts/audit-shohibul-names.js --all-status   # include pending too

const { Client } = require('pg');
const fs = require('fs');

const env = fs
  .readFileSync('/Users/fajarfirdaus/Development/wa-bot/.env', 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (m) acc[m[1].trim()] = m[2];
    return acc;
  }, {});

const includeAll = process.argv.includes('--all-status');

// Expected number of names per animal type (based on syariat)
const EXPECTED_NAMES = {
  DOMBA: { min: 1, max: 1 },
  KAMBING: { min: 1, max: 1 },
  SAPI_PERORANGAN: { min: 1, max: 7 }, // sapi can be 1-7 sohibul
  SAPI_KOLEKTIF: { min: 1, max: 7 },
  SAPI_KOLEKTIF_A: { min: 1, max: 7 },
  SAPI_KOLEKTIF_B: { min: 1, max: 7 },
  SAPI_KOLEKTIF_C: { min: 1, max: 7 },
};

async function main() {
  const client = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const where = includeAll
    ? 'deleted_at IS NULL'
    : "deleted_at IS NULL AND status = 'CONFIRMED'";
  const { rows } = await client.query(
    `SELECT registration_number, name, shohibul_name, animal_type, status, phone
     FROM pengkurban WHERE ${where}
     ORDER BY animal_type, registration_number`,
  );

  console.log(`\n=== Audit Nama Sohibul (${rows.length} rows, ${includeAll ? 'ALL STATUS' : 'CONFIRMED only'}) ===\n`);

  const anomalies = [];

  for (const r of rows) {
    const flags = [];
    const sn = (r.shohibul_name || '').trim();
    const names = sn.split('\n').map((n) => n.trim()).filter(Boolean);
    const expected = EXPECTED_NAMES[r.animal_type] || { min: 1, max: 7 };

    if (!sn) {
      flags.push('❌ shohibul_name KOSONG');
    } else {
      if (names.length < expected.min) {
        flags.push(`⚠️  jumlah nama (${names.length}) < expected min (${expected.min})`);
      }
      if (names.length > expected.max) {
        flags.push(`⚠️  jumlah nama (${names.length}) > expected max (${expected.max}) untuk ${r.animal_type}`);
      }
      // Suspicious: same as pendaftar name exactly (mungkin lupa edit / single-sohibul OK)
      if (sn === r.name) {
        flags.push('ℹ️  shohibul_name SAMA dgn nama pendaftar (mungkin sengaja kalau 1 sohibul)');
      }
      // Check tiap nama: ada "bin" or "binti"
      const noBinNames = names.filter(
        (n) => !/\b(bin|binti)\b/i.test(n) && !/\b(b\.|bt\.)\b/i.test(n),
      );
      if (noBinNames.length > 0) {
        flags.push(`⚠️  nama tanpa bin/binti: ${noBinNames.map((n) => `"${n}"`).join(', ')}`);
      }
      // Very short names (suspicious)
      const tooShort = names.filter((n) => n.length < 5);
      if (tooShort.length > 0) {
        flags.push(`⚠️  nama terlalu pendek: ${tooShort.map((n) => `"${n}"`).join(', ')}`);
      }
      // Names with numbers (suspicious)
      const hasNum = names.filter((n) => /\d/.test(n));
      if (hasNum.length > 0) {
        flags.push(`⚠️  nama mengandung angka: ${hasNum.map((n) => `"${n}"`).join(', ')}`);
      }
    }

    if (flags.length > 0) {
      anomalies.push({ ...r, names, flags });
    }
  }

  // Group by anomaly severity
  const errors = anomalies.filter((a) => a.flags.some((f) => f.startsWith('❌')));
  const warnings = anomalies.filter(
    (a) => !a.flags.some((f) => f.startsWith('❌')) && a.flags.some((f) => f.startsWith('⚠️')),
  );
  const info = anomalies.filter(
    (a) =>
      !a.flags.some((f) => f.startsWith('❌')) &&
      !a.flags.some((f) => f.startsWith('⚠️')),
  );

  if (errors.length > 0) {
    console.log(`\n🚨 ERRORS (${errors.length}):\n`);
    errors.forEach((a) => printRow(a));
  }
  if (warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${warnings.length}):\n`);
    warnings.forEach((a) => printRow(a));
  }
  if (info.length > 0) {
    console.log(`\nℹ️  INFO (${info.length}):\n`);
    info.forEach((a) => printRow(a));
  }

  console.log(
    `\n=== Total: ${rows.length} pengkurban | ${anomalies.length} flagged (${errors.length} err, ${warnings.length} warn, ${info.length} info) ===\n`,
  );

  await client.end();
}

function printRow(a) {
  console.log(`  ${a.registration_number}  [${a.animal_type}]  pendaftar: ${a.name}`);
  if (a.names.length === 0) {
    console.log(`    shohibul_name: (kosong)`);
  } else {
    a.names.forEach((n, i) => console.log(`    ${i + 1}. ${n}`));
  }
  a.flags.forEach((f) => console.log(`    ${f}`));
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
