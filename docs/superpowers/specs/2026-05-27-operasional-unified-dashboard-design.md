# Operasional Dashboard — Unified Timeline

## Goal & scope

Hapus dropdown `teamSelect` di halaman `/operasional`. Tampilkan hewan tim SAPI dan tim KAMBING/DOMBA digabung dalam satu timeline tunggal per section (Sedang dipotong / Antrian berikutnya / Selesai), dengan tim ditandai sebagai badge per-card. Tujuan: panitia bisa lihat status kedua tim sekaligus tanpa toggle.

Tidak ada perubahan fitur fungsional — hanya layout & data presentation. Auto-refresh, action button (Mulai/Selesai/Tunda/Reset/Foto), public mode (view-only) tetap.

## Frontend changes (`client/operasional.html`)

**Hapus:**
- `<select id="teamSelect">` element dan dua `<option>`-nya.
- Local var `currentTeam` + handler `$('#teamSelect').onchange`.
- Query param `&team=${currentTeam}` di kedua API call (logged-in `/scheduling/ops` + public `/api/portal/scheduling/ops-public`).

**Tambah:**
- Helper `teamBadge(animalType)` → returns HTML chip:
  - SAPI types (`SAPI_PERORANGAN`, `SAPI_KOLEKTIF_A/B/C`, legacy `SAPI_KOLEKTIF`) → chip amber `🐄 SAPI`.
  - DOMBA/KAMBING → chip emerald `🐑 KMB`.
- Chip CSS dimasukkan di `<style>` block existing:
  ```css
  .team-chip { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 6px; }
  .team-chip.sapi { background: rgba(245,158,11,0.25); color: #fbbf24; }
  .team-chip.kmb { background: rgba(16,185,129,0.25); color: #34d399; }
  ```
- Render badge di kiri sohibul name di tiap card render function (current/next/done).
- Counts header: include per-team breakdown:
  ```
  Antri: 17 (🐄 5 + 🐑 12) • Sedang: 3 (🐄 1 + 🐑 2) • Selesai: 12 (🐄 8 + 🐑 4)
  ```

**Layout (no changes):**
- Tetap 3 section (current / next / done), satu list per section.
- Card layout sama, hanya tambah chip di header.

## Backend changes

### `src/scheduling/scheduling.service.ts` — `getOpsData()`

Existing signature: `getOpsData(eventId: string, team: Team)`.
New signature: `getOpsData(eventId: string, team?: Team)`.

**Behavior:**
- Jika `team` di-provide → query existing `where: { eventId, scheduledTeam: team }` (no behavior change, backwards-compat).
- Jika `team` omitted → query semua hewan event (`where: { eventId }`), tanpa filter team.
- `next` (waiting top 10), `recent` (done 5 terakhir), `current` (IN_PROGRESS) semua di-merge cross-team setelah filter status. Slice setelah merge & sort.

**Return shape — extend:**
```ts
{
  current: AnimalWithSohibul[];
  next: AnimalWithSohibul[];
  recent: AnimalWithSohibul[];
  waitingCount: number;
  doneCount: number;
  // NEW: per-team breakdown
  waitingByTeam: { SAPI: number; KAMBING_DOMBA: number };
  doneByTeam: { SAPI: number; KAMBING_DOMBA: number };
  currentByTeam: { SAPI: number; KAMBING_DOMBA: number };
}
```

Breakdown dihitung dari `all` array (semua hewan event), filter by `scheduledTeam`. Per-team breakdown TIDAK conditional pada apakah `team` param di-pass — selalu di-emit (lebih konsisten, & frontend menggunakan langsung).

### `src/scheduling/scheduling.controller.ts` & `scheduling.portal.controller.ts`

Update endpoint handler — buat `team` query param optional, pass undefined ke service kalau ga ada.

```ts
@Get('ops')
async getOps(
  @Query('eventId') eventId: string,
  @Query('team') team?: Team,  // optional now
) {
  return this.schedulingService.getOpsData(eventId, team);
}
```

## Tests

### `src/scheduling/scheduling.service.spec.ts` — extend
- Test case: `getOpsData(eventId)` tanpa team — return merged data + breakdown.
- Test case: `getOpsData(eventId, 'SAPI')` — backwards-compat, hanya SAPI animals.
- Test case: breakdown count akurat ketika ada hewan WAITING/IN_PROGRESS/DONE di kedua tim.

### Manual (no automated UI tests)
- Buka `/operasional` di browser: verify dropdown gone, kedua tim's animals muncul dalam list, badge benar warna sesuai tim, counts breakdown akurat.
- Logged-out (public mode): sama, action buttons hidden.

## Non-goals (YAGNI)
- Tidak ada per-team filter button — selalu campur.
- Tidak ada animasi/transition reflow saat status berubah — refresh tetap full re-render.
- Tidak ubah auto-refresh interval (30s tetap).
- Backwards compat API: `team` param tetap diterima — frontend lain (kalau ada) tidak break.

## Risk & mitigation

- **Loss of focus** kalau panitia tim sapi mau lihat hanya sapi: badge yang jelas + warna distinct mengatasi ini. Kalau jadi masalah real di lapangan, tambah filter chip kemudian — tapi YAGNI dulu.
- **Backend payload size**: merged list lebih kecil dari 2 separate calls (1 query vs 2 queries × 2 modes). Net win.
