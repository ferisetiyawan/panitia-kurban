#!/usr/bin/env node
// Topup + (optionally) anonymize an existing donation row.
//
// Use case: existing donor transfers additional amount and wants to be displayed
// as "Hamba Allah" without address — follows Vino's pattern
// (donation 9790e6e8-3e76-4e18-9442-2b19d52ee620).
//
// Actions performed (gated by --execute):
//   1. UPDATE donations row: amount += add-amount; if --anonymize: name/address/phone
//      reset to Hamba Allah/null/null.
//   2. Rewrite notes: prepend anonymization line (if --anonymize) + internal identity
//      block (real name, phone, address, context) + preserve old notes + append new
//      bukti detail.
//   3. If --proof: scp the local file to <REMOTE_PATH>/uploads/donation-proofs/
//      using filename pattern <id>-<timestamp-ms>.<ext>, then append that relative
//      path to payment_proof_paths (JSON-encoded string array, simple-json column).
//
// Default: dry-run (prints the UPDATE + planned scp). Pass --execute to commit.
//
// Usage:
//   node scripts/topup-anonymize-donation.js \
//     --id <uuid> \
//     --add-amount 500000 \
//     [--anonymize] \
//     [--internal-identity "Real Name, phone, alamat, context"] \
//     [--bukti-text "Bank BCA → Muamalat ..., 22/05/2026 19:27:40 WIB, Rp 500.000, Ref ..."] \
//     [--proof "/local/path/to/image.jpeg"] \
//     [--execute]
//
// Env required:
//   panitia-kurban/.env: CPANEL_HOST, CPANEL_USER (only when --proof)
//   wa-bot/.env (loaded via wa-bot/scripts/_env): DB creds for shared neondb
//
// Safety:
//   - Default dry-run.
//   - Re-quotes the SQL via parameterized query (no interpolation of user text).
//   - SCP filename uses Date.now() — won't collide with existing proofs.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Load wa-bot env + panitiaPool
const waBotRoot = '/Users/fajarfirdaus/Development/wa-bot';
require(path.join(waBotRoot, 'scripts/_env'));
const { panitiaPool } = require(path.join(waBotRoot, 'db'));

// Load panitia-kurban .env for CPANEL_* (minimal parser, no dotenv dep)
const pkEnvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(pkEnvPath)) {
  const lines = fs.readFileSync(pkEnvPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!(k in process.env)) {
      process.env[k] = v.replace(/^["']|["']$/g, '');
    }
  }
}

// ---- arg parsing ---------------------------------------------------------

const args = process.argv.slice(2);
function getFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
function hasFlag(name) {
  return args.includes(name);
}

const id = getFlag('--id');
const addAmountStr = getFlag('--add-amount');
const anonymize = hasFlag('--anonymize');
const internalIdentity = getFlag('--internal-identity');
const buktiText = getFlag('--bukti-text');
const proof = getFlag('--proof');
const execute = hasFlag('--execute');

if (!id || !addAmountStr) {
  console.error(
    'Usage: node scripts/topup-anonymize-donation.js --id <uuid> --add-amount <number> [--anonymize] [--internal-identity "..."] [--bukti-text "..."] [--proof "/file"] [--execute]',
  );
  process.exit(1);
}

const addAmount = Number(addAmountStr);
if (!Number.isFinite(addAmount) || addAmount <= 0) {
  console.error('[err] --add-amount must be a positive number, got:', addAmountStr);
  process.exit(2);
}

// ---- main ---------------------------------------------------------------

async function main() {
  // 1. Fetch current row
  const r = await panitiaPool.query(
    'SELECT id, name, address, phone, amount, status, notes, payment_proof_paths, created_at FROM donations WHERE id = $1',
    [id],
  );
  if (r.rows.length === 0) {
    console.error('[err] donation not found:', id);
    process.exit(3);
  }
  const cur = r.rows[0];
  console.log('[before]', JSON.stringify(cur, null, 2));

  // 2. Compute next state
  const nextAmount = (Number(cur.amount) + addAmount).toFixed(2);
  const nextName = anonymize ? 'Hamba Allah' : cur.name;
  const nextAddress = anonymize ? null : cur.address;
  const nextPhone = anonymize ? null : cur.phone;

  // Notes composition
  const parts = [];
  if (anonymize) {
    parts.push('Donatur minta anonim ("Hamba Allah") di rekap public.');
  }
  if (internalIdentity) {
    parts.push(`Identitas internal: ${internalIdentity}.`);
  }
  if (cur.notes) {
    parts.push('--- catatan sebelumnya ---');
    parts.push(cur.notes);
  }
  if (buktiText) {
    parts.push('--- bukti tambahan ---');
    parts.push(buktiText);
  }
  const nextNotes = parts.join('\n');

  // 3. Proof file plan
  let proofRelPath = null;
  let proofLocal = null;
  if (proof) {
    proofLocal = path.resolve(proof.replace(/^~/, process.env.HOME || ''));
    if (!fs.existsSync(proofLocal)) {
      console.error('[err] proof file not found:', proofLocal);
      process.exit(4);
    }
    const ext = path.extname(proofLocal).toLowerCase() || '.jpeg';
    const filename = `${id}-${Date.now()}${ext}`;
    proofRelPath = `uploads/donation-proofs/${filename}`;
  }

  // payment_proof_paths column is text storing JSON array (simple-json typeorm)
  let nextProofPaths = cur.payment_proof_paths;
  if (proofRelPath) {
    let existing = [];
    if (cur.payment_proof_paths) {
      try {
        existing = JSON.parse(cur.payment_proof_paths);
        if (!Array.isArray(existing)) existing = [];
      } catch {
        existing = [];
      }
    }
    nextProofPaths = JSON.stringify([...existing, proofRelPath]);
  }

  console.log('\n[plan]');
  console.log('  amount:        ', cur.amount, '→', nextAmount);
  console.log('  name:          ', JSON.stringify(cur.name), '→', JSON.stringify(nextName));
  console.log('  address:       ', JSON.stringify(cur.address), '→', JSON.stringify(nextAddress));
  console.log('  phone:         ', JSON.stringify(cur.phone), '→', JSON.stringify(nextPhone));
  console.log('  payment_proof: ', JSON.stringify(cur.payment_proof_paths), '→', JSON.stringify(nextProofPaths));
  console.log('  notes (new):');
  console.log(nextNotes.split('\n').map((l) => '    ' + l).join('\n'));

  if (proofLocal) {
    const remotePath = process.env.REMOTE_PATH || 'public_html/kurban.masjidalhijrahcge.id';
    const cpHost = process.env.CPANEL_HOST;
    const cpUser = process.env.CPANEL_USER;
    if (!cpHost || !cpUser) {
      console.error('\n[err] --proof requires CPANEL_HOST and CPANEL_USER in panitia-kurban/.env');
      process.exit(5);
    }
    console.log(`\n[proof upload plan]`);
    console.log(`  local: ${proofLocal}`);
    console.log(`  scp -> ${cpUser}@${cpHost}:${remotePath}/${proofRelPath}`);
  }

  if (!execute) {
    console.log('\n[dry-run] re-run with --execute to apply');
    return;
  }

  // 4. SCP first (if any) — fail-fast before DB mutation
  if (proofLocal) {
    const remotePath = process.env.REMOTE_PATH || 'public_html/kurban.masjidalhijrahcge.id';
    const cpHost = process.env.CPANEL_HOST;
    const cpUser = process.env.CPANEL_USER;
    const dest = `${cpUser}@${cpHost}:${remotePath}/${proofRelPath}`;
    console.log(`\n[scp] ${proofLocal} -> ${dest}`);
    const result = spawnSync('scp', ['-q', proofLocal, dest], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error('[err] scp failed, aborting DB update');
      process.exit(6);
    }
    console.log('  ✓ proof uploaded');
  }

  // 5. UPDATE
  const updateSql = `
    UPDATE donations
    SET amount = $1,
        name = $2,
        address = $3,
        phone = $4,
        notes = $5,
        payment_proof_paths = $6
    WHERE id = $7
    RETURNING id, name, address, phone, amount, status, payment_proof_paths
  `;
  const params = [
    nextAmount,
    nextName,
    nextAddress,
    nextPhone,
    nextNotes,
    nextProofPaths,
    id,
  ];
  const upd = await panitiaPool.query(updateSql, params);
  console.log('\n[after]', JSON.stringify(upd.rows[0], null, 2));
}

main()
  .catch((e) => {
    console.error('[err]', e.stack || e.message);
    process.exit(99);
  })
  .finally(() => panitiaPool.end());
