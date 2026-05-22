#!/usr/bin/env node
// Swap payment_proof_paths antara 2 pengkurban entries, terus soft-delete salah satu.
// Use case: ada 2 entry dimana bukti transfer-nya ke-tuker (e.g. duplicate entry
// yang transfer-nya seharusnya milik entry lain).
//
// Flow:
//   1) Validate REG_KEEP & REG_DELETE exist (REG_DELETE not yet deleted)
//   2) Resolve current payment_proof_paths from REG_DELETE
//   3) UPDATE REG_KEEP.payment_proof_paths = [REG_DELETE's proof path(s)]
//      + optional --clear-notes (set notes to NULL)
//   4) UPDATE REG_DELETE SET deleted_at = NOW()
//   5) Verify final state
//
// Usage:
//   node scripts/swap-proof-and-soft-delete.js <REG_KEEP> <REG_DELETE> [--clear-notes] [--apply]
//
// Default dry-run.

const path = require('path');
const waBotRoot = '/Users/fajarfirdaus/Development/wa-bot';
require(path.join(waBotRoot, 'scripts/_env'));
const { panitiaPool } = require(path.join(waBotRoot, 'db'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const clearNotes = args.includes('--clear-notes');

const positional = args.filter((a) => !a.startsWith('--'));
const [regKeep, regDelete] = positional;

if (!regKeep || !regDelete) {
  console.error(
    'Usage: node scripts/swap-proof-and-soft-delete.js <REG_KEEP> <REG_DELETE> [--clear-notes] [--apply]',
  );
  process.exit(1);
}

if (regKeep === regDelete) {
  console.error('[err] REG_KEEP and REG_DELETE must be different');
  process.exit(1);
}

async function main() {
  // 1) Resolve both
  const res = await panitiaPool.query(
    `SELECT id, registration_number, name, status, payment_proof_paths, notes, deleted_at
     FROM pengkurban
     WHERE registration_number = ANY($1::text[])`,
    [[regKeep, regDelete]],
  );
  const byReg = Object.fromEntries(res.rows.map((r) => [r.registration_number, r]));
  const keep = byReg[regKeep];
  const del = byReg[regDelete];

  if (!keep) {
    console.error('[err] REG_KEEP not found:', regKeep);
    process.exit(2);
  }
  if (!del) {
    console.error('[err] REG_DELETE not found:', regDelete);
    process.exit(2);
  }
  if (del.deleted_at) {
    console.error('[err] REG_DELETE already soft-deleted at', del.deleted_at);
    process.exit(2);
  }

  console.log('[KEEP]', JSON.stringify(keep, null, 2));
  console.log('[DELETE]', JSON.stringify(del, null, 2));

  // 2) Parse proof paths from REG_DELETE
  let newProofs;
  try {
    const raw = del.payment_proof_paths;
    newProofs = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  } catch (e) {
    console.error('[err] failed to parse REG_DELETE payment_proof_paths', e.message);
    process.exit(3);
  }

  if (newProofs.length === 0) {
    console.error('[err] REG_DELETE has no payment_proof_paths to swap');
    process.exit(3);
  }

  console.log('\n[plan]');
  console.log(`  - UPDATE ${regKeep}.payment_proof_paths = ${JSON.stringify(newProofs)}`);
  if (clearNotes) {
    console.log(`  - UPDATE ${regKeep}.notes = NULL  (was: ${JSON.stringify(keep.notes)})`);
  }
  console.log(`  - UPDATE ${regDelete} SET deleted_at = NOW()`);

  if (!apply) {
    console.log('\n[dry-run] re-run with --apply buat commit ke DB');
    return;
  }

  // 3) Apply in a transaction
  const client = await panitiaPool.connect();
  try {
    await client.query('BEGIN');

    const updateKeepCols = ['payment_proof_paths = $1'];
    const updateKeepVals = [JSON.stringify(newProofs)];
    if (clearNotes) {
      updateKeepCols.push('notes = NULL');
    }
    updateKeepVals.push(keep.id);

    await client.query(
      `UPDATE pengkurban SET ${updateKeepCols.join(', ')} WHERE id = $${updateKeepVals.length}`,
      updateKeepVals,
    );

    await client.query(`UPDATE pengkurban SET deleted_at = NOW() WHERE id = $1`, [del.id]);

    await client.query('COMMIT');
    console.log('\n[commit] OK');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[err] rollback:', e.stack || e.message);
    process.exit(4);
  } finally {
    client.release();
  }

  // 4) Verify
  const finalRes = await panitiaPool.query(
    `SELECT registration_number, status, payment_proof_paths, notes, deleted_at
     FROM pengkurban
     WHERE registration_number = ANY($1::text[])`,
    [[regKeep, regDelete]],
  );
  console.log('\n[final state]', JSON.stringify(finalRes.rows, null, 2));
}

main()
  .catch((e) => {
    console.error('[err]', e.stack || e.message);
    process.exit(99);
  })
  .finally(() => panitiaPool.end());
