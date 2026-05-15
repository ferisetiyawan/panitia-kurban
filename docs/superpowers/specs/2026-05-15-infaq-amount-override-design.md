# Infaq Amount Override + REG-2026-0017 Soft Delete

**Date:** 2026-05-15
**Status:** Approved

## Summary

Two related changes to panitia-kurban:

1. Add a nullable `infaq_amount` column to `pengkurban` that overrides the hardcoded per-animal-type infaq amount. When set to 0, the UI shows a "Dibebaskan" badge instead of "BELUM" and no payment action is required. CSV export reflects the override.
2. Soft-delete REG-2026-0017 from the database so it no longer appears in the admin pengkurban list.

## Motivation

Didin (REG-2026-0020, SAPI_PERORANGAN) pays infaq via potongan daging — no cash infaq due. The current schema has no way to express a 0-infaq override: the amount is hardcoded to 1,750,000 for SAPI_PERORANGAN everywhere. The UI shows "BELUM", the CSV shows 1,750,000 — both misleading.

REG-2026-0017 needs to be removed from the active list.

## Schema Change

```sql
ALTER TABLE pengkurban
  ADD COLUMN infaq_amount NUMERIC(12,2) NULL;
```

- `NULL` → use existing `getInfaqAmount(animalType)` (no behaviour change for existing rows)
- Any explicit value including `0` → use that value instead

TypeORM `synchronize: true` will apply this automatically on next deploy.

## Files Changed

### `src/pengkurban/pengkurban.entity.ts`
Add field:
```ts
@Column({ name: 'infaq_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
infaqAmount: number | null;
```

### `src/pengkurban/dto/pengkurban.dto.ts`
Add to `UpdatePengkurbanDto`:
```ts
@IsOptional()
@IsNumber()
@Type(() => Number)
infaqAmount?: number | null;
```

### `src/pengkurban/pengkurban.service.ts`

**`exportCsv`** — resolve effective infaq amount per row:
```ts
const infaqAmount = d.infaqAmount != null ? Number(d.infaqAmount) : getInfaqAmount(d.animalType);
```
CSV "Status Infaq" column:
```ts
infaqAmount === 0 ? 'Dibebaskan' : (d.infaqPaid ? 'Lunas' : 'Belum')
```

### `client/pengkurban.html`

**Amount display** — the existing `getInfaq(animalType)` JS helper is frontend-only and reads from `/api/public/pricing`. Replace the per-row infaq display to use `d.infaqAmount ?? getInfaq(d.animalType)` (server value takes precedence).

**Badge + button logic:**
```js
if (d.infaqAmount === 0) {
  // Dibebaskan — no action needed
  infaqBadge = `<span class="badge badge-neutral">Dibebaskan</span>`
  infaqBtn = ''
} else {
  // existing BELUM / Lunas logic
}
```

**Amount label:**
```js
const effectiveInfaq = d.infaqAmount != null ? d.infaqAmount : getInfaq(d.animalType);
// render Rp effectiveInfaq.toLocaleString('id-ID')
```

## wa-bot (`kurban-client.js`)

No change. `hasInfaqWaiver()` already excludes Didin from the cash rekap via the `infaq:potongan` notes marker. The two repos stay loosely coupled.

## Data Fix (post-deploy)

Run directly against Neon DB:

```sql
-- Set infaq_amount = 0 for Didin
UPDATE pengkurban
SET infaq_amount = 0
WHERE id = 'c9e967d8-f8b5-4bcc-81aa-fc5ceeb35f8c';

-- Soft-delete REG-2026-0017
UPDATE pengkurban
SET deleted_at = NOW()
WHERE registration_number = 'REG-2026-0017';
```

## CSV Output (after change)

| Column | Didin before | Didin after |
|---|---|---|
| Infaq Operasional | 1750000 | 0 |
| Status Infaq | Belum | Dibebaskan |

## Out of Scope

- Public registration form — no infaq override input (panitia-only operation via PATCH)
- wa-bot rekap — already handled via notes marker
- Any UI to set infaq_amount from the admin table — PATCH endpoint is sufficient for now (curl or future Edit modal)
