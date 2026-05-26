#!/usr/bin/env node
// One-off backfill: populate infaq_amount untuk existing pengkurban rows.
//
// Rules:
//  - Rows dengan notes marker `infaq:potongan` atau `infaq:waived` → NULL
//    (di-skip dari rekap sumbangan).
//  - Other rows → getInfaqAmount(animal_type):
//      SAPI_PERORANGAN: 1750000
//      Lainnya (DOMBA, KAMBING, SAPI_KOLEKTIF*): 300000
//  - Cuma update kalau infaq_amount IS NULL (don't overwrite admin overrides).
//
// PRE-CONDITION: column infaq_amount harus sudah ke-create di DB (via TypeORM
// synchronize setelah deploy entity change). Run script INI POST-deploy.
//
// Usage:
//   node scripts/backfill-infaq-amount.js              # dry-run (default)
//   node scripts/backfill-infaq-amount.js --apply      # actual UPDATE

const path = require('path');
const waBotRoot = '/Users/fajarfirdaus/Development/wa-bot';
require(path.join(waBotRoot, 'scripts/_env'));
const { panitiaPool } = require(path.join(waBotRoot, 'db'));

const apply = process.argv.includes('--apply');

const INFAQ_AMOUNT = {
  DOMBA: 300000,
  KAMBING: 300000,
  SAPI_KOLEKTIF: 300000,
  SAPI_KOLEKTIF_A: 300000,
  SAPI_KOLEKTIF_B: 300000,
  SAPI_KOLEKTIF_C: 300000,
  SAPI_PERORANGAN: 1750000,
};
const hasInfaqWaiver = (notes) =>
  !!notes && /infaq\s*:\s*(potongan|waived)/i.test(notes);

(async () => {
  try {
    // Pre-check: column ada?
    const colCheck = await panitiaPool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pengkurban' AND column_name = 'infaq_amount'`,
    );
    if (colCheck.rows.length === 0) {
      console.error(
        '[err] column infaq_amount belum ada di tabel pengkurban. Deploy entity change dulu (TypeORM synchronize akan auto-add).',
      );
      process.exit(2);
    }

    const r = await panitiaPool.query(
      `SELECT id, registration_number, name, animal_type, notes, infaq_amount
       FROM pengkurban
       WHERE deleted_at IS NULL AND infaq_amount IS NULL
       ORDER BY created_at ASC`,
    );
    console.log(`[scan] ${r.rows.length} rows with infaq_amount=NULL`);

    let toWaive = 0;
    let toSet = 0;
    const updates = [];
    for (const row of r.rows) {
      if (hasInfaqWaiver(row.notes)) {
        // Skip — sudah NULL by default, ga perlu update.
        toWaive++;
        continue;
      }
      const amt = INFAQ_AMOUNT[row.animal_type] ?? 0;
      if (!amt) {
        console.warn(
          `[warn] ${row.registration_number} ${row.name}: animal_type ${row.animal_type} ga ada di INFAQ_AMOUNT — skip`,
        );
        continue;
      }
      updates.push({ id: row.id, amt });
      toSet++;
    }

    console.log(
      `[plan] ${toSet} rows → set to default infaq_amount, ${toWaive} rows → keep NULL (waiver via notes marker)`,
    );

    if (!apply) {
      console.log('[dry-run] re-run with --apply untuk execute');
      return;
    }

    console.log('[apply] running UPDATEs...');
    let done = 0;
    for (const u of updates) {
      await panitiaPool.query(
        `UPDATE pengkurban SET infaq_amount = $1 WHERE id = $2`,
        [u.amt, u.id],
      );
      done++;
    }
    console.log(`[done] updated ${done} rows`);
  } catch (e) {
    console.error('[err]', e.stack || e.message);
    process.exit(3);
  } finally {
    await panitiaPool.end();
  }
})();
