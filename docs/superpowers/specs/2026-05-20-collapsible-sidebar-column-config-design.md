# Collapsible Sidebar + Column Visibility Config

**Date:** 2026-05-20
**Scope:** Admin UI (post-login pages) — `client/`

## Goal

Beri admin kontrol atas tampilan UI:
1. **Sidebar collapsible** — bisa shrink ke icon-only untuk hemat space horizontal.
2. **Column visibility config** — pilih kolom mana yang ditampilkan di tabel pengkurban & donations (kolom yang ditambah seiring waktu bikin tabel makin lebar — bagi user yang ga butuh semua kolom, mereka bisa hide yang ga relevan).

Persist preferensi user di **localStorage** (per-device wajar untuk UI state, no backend change).

## Non-goals

- Reorder kolom (drag-to-reorder) — visibility only.
- Column config untuk tabel selain pengkurban & donations (vouchers / activity-logs nanti kalau perlu).
- Sync preferensi antar device — localStorage cukup.
- Resizable column width.

## Architecture

### Storage shape

```js
localStorage[`prefs:${userId}`] = JSON.stringify({
  sidebarCollapsed: false,
  columns: {
    pengkurban: ['regNo','pendaftar','atasNama','jenisHewan','perkiraanTotal','alamat','bukti','status','infaq','konfirmasi','aksi'],
    donations: ['nama','noWa','nominal','bukti','status','waktu','aksi']
  }
})
```

- Namespaced per `userId` — kalau ada multi-user di browser yang sama (e.g., admin pinjam laptop), prefs ga ketuker.
- `columns.<page>` adalah array of column IDs yang **visible**. Default = semua kolom (full list).
- Kalau key belum ada di localStorage → pakai defaults. Kalau ada column ID di defaults tapi belum di-track di localStorage (kasus baru tambah kolom di kode), treat sebagai visible by default.

### Helpers (di `client/js/app.js`)

```js
function getPrefs() {
  const user = getUser();
  if (!user) return {};
  try {
    return JSON.parse(localStorage.getItem(`prefs:${user.id}`)) || {};
  } catch (e) {
    console.error('[prefs] parse failed', e.message);
    return {};
  }
}

function setPrefs(patch) {
  const user = getUser();
  if (!user) return;
  const current = getPrefs();
  const next = { ...current, ...patch };
  localStorage.setItem(`prefs:${user.id}`, JSON.stringify(next));
}

function getColumnPrefs(page, defaults) {
  const prefs = getPrefs();
  const stored = prefs.columns?.[page];
  if (!stored || !Array.isArray(stored) || stored.length === 0) return defaults;
  // Defensive: keep only known columns (defaults may have shrunk).
  const known = stored.filter(id => defaults.includes(id));
  if (known.length === 0) return defaults;
  // Forward-compat: if defaults added new columns not in stored, treat as visible.
  // This means newly-added columns auto-appear for existing users.
  const newOnes = defaults.filter(id => !known.includes(id));
  return [...known, ...newOnes];
}

function setColumnPrefs(page, visibleIds) {
  const prefs = getPrefs();
  setPrefs({ columns: { ...(prefs.columns || {}), [page]: visibleIds } });
}
```

### Sidebar collapse

**Markup** (di `app.js initSidebar`, prepend ke `.sidebar-logo`):
- Tombol chevron icon di pojok kanan atas sidebar (di header bareng logo).
- Klik → toggle class `.collapsed` di `<aside class="sidebar">` + pada `<body>` (untuk adjust `main-content` margin).
- Persist ke `prefs.sidebarCollapsed`.

**CSS:**
```css
.sidebar.collapsed { width: 64px; }
.sidebar.collapsed .sidebar-logo h1,
.sidebar.collapsed .sidebar-logo p,
.sidebar.collapsed .sidebar-nav a span /* label text */ {
  display: none;
}
.sidebar.collapsed .sidebar-nav a {
  justify-content: center;
  padding: 12px;
}
body.sidebar-collapsed .main-content {
  margin-left: 64px;
}
.sidebar, .main-content { transition: width 0.2s ease, margin-left 0.2s ease; }

/* Mobile (≤768px): collapse is a no-op, mobile pakai existing toggle */
@media (max-width: 768px) {
  .sidebar.collapsed { width: 260px; } /* override desktop collapse */
}
```

**Restore-on-load:** sebelum sidebar di-render, baca `prefs.sidebarCollapsed` dan apply class. Tidak ada flash karena render sidebar terjadi setelah class diset.

**Label change:** label nav saat ini ditulis sebagai text node `${item.label}` di template. Bungkus jadi `<span>${item.label}</span>` supaya bisa di-hide via CSS.

### Column visibility — pengkurban & donations

**Toolbar button:**
```html
<button class="btn-secondary" onclick="openColumnConfig()">⚙ Kolom</button>
```
Tempatkan sebelum `📥 Export CSV` di toolbar (`pengkurban.html` line ~41, `donations.html` similar).

**Popover** (single instance per page, absolute positioned di samping button):
```html
<div id="column-config-popover" class="popover" hidden>
  <div class="popover-header">Tampilkan Kolom</div>
  <div class="popover-body" id="column-config-items"><!-- checkboxes injected --></div>
  <div class="popover-footer">
    <button class="btn-secondary" onclick="resetColumnConfig()">Reset default</button>
  </div>
</div>
```

**Column registry per page** (di top of page-specific script):
```js
const COLUMN_DEFS_PENGKURBAN = [
  { id: 'regNo', label: 'No. Reg' },
  { id: 'pendaftar', label: 'Nama Pendaftar' },
  { id: 'atasNama', label: 'Atas Nama Qurban' },
  { id: 'jenisHewan', label: 'Jenis Hewan' },
  { id: 'perkiraanTotal', label: 'Perkiraan Total' },
  { id: 'alamat', label: 'Alamat' },
  { id: 'bukti', label: 'Bukti' },
  { id: 'status', label: 'Status' },
  { id: 'infaq', label: 'Infaq' },
  { id: 'konfirmasi', label: 'Konfirmasi' },
  { id: 'aksi', label: 'Aksi' },
];
// donations: nama, noWa, nominal, bukti, status, waktu, aksi
```

**Markup change pada tabel:**
- Setiap `<th>` di `<thead>` dapat `data-col="<id>"`.
- Setiap `<td>` di renderer row (`renderTable`/`renderRow`) dapat `data-col="<id>"` matching.

**Applying visibility:**
```css
.data-table [data-col].col-hidden { display: none; }
```
```js
function applyColumnVisibility(page, defs) {
  const visible = getColumnPrefs(page, defs.map(d => d.id));
  defs.forEach(({ id }) => {
    const hidden = !visible.includes(id);
    document.querySelectorAll(`.data-table [data-col="${id}"]`)
      .forEach(el => el.classList.toggle('col-hidden', hidden));
  });
}
```
Panggil `applyColumnVisibility` setelah setiap kali tabel di-render (initial load + setelah CRUD action) dan saat checkbox di popover berubah.

**Popover behavior:**
- Build checkbox list dari `COLUMN_DEFS_*`, check sesuai prefs.
- onChange handler: cek minimal 1 kolom tetap checked — kalau user uncheck checkbox terakhir, abort + tampilkan toast "Minimal 1 kolom harus ditampilkan." dan revert checkbox.
- Setiap perubahan → simpan ke localStorage + apply visibility realtime.
- Click outside → close (listener pada `document` saat popover open, remove saat close).
- `Reset default` → set ke full list, update checkbox state + apply.

**Empty/loading colspan handling:**
Pada `pengkurban.html` line 68 ada `<td colspan="11">` untuk loading/empty state. Pakai `colspan="99"` (over-sized OK di HTML, simpler dari hitung dinamis tiap kali column visibility berubah).

## Files yang berubah

| File | Perubahan |
|---|---|
| `client/css/style.css` | `.sidebar.collapsed`, `body.sidebar-collapsed .main-content`, `.col-hidden`, `.popover*`, label `<span>` rules |
| `client/js/app.js` | `getPrefs/setPrefs/getColumnPrefs/setColumnPrefs` helpers; `initSidebar` extended dengan toggle button + restore state; label wrap dengan `<span>` |
| `client/pengkurban.html` | Tambah `data-col` di `<th>`; tambah button "Kolom" + popover; tambah script untuk `COLUMN_DEFS`, `applyColumnVisibility`, popover handlers; renderer row tambah `data-col` di tiap `<td>` |
| `client/donations.html` | Same pattern as pengkurban |

Halaman lain (dashboard, events, vouchers, scanner, users, analytics, activity-logs) tetap dapat sidebar collapse otomatis karena pakai `app.js` shared — tanpa perubahan.

## Testing (manual)

1. **Sidebar:**
   - Login → sidebar full → klik toggle → shrink ke icon-only → label hilang, icon tetap clickable.
   - Reload page → sidebar tetap collapsed (persisted).
   - Toggle balik → expand smooth.
   - Mobile viewport (≤768px) → toggle button hidden / no-op, bottom-nav existing tetap.
2. **Column config — pengkurban:**
   - Buka pengkurban → klik "Kolom" → popover muncul, semua checked.
   - Uncheck "Alamat" → kolom Alamat hilang di header + semua row.
   - Reload → state persist.
   - Uncheck semua kecuali 1 → uncheck terakhir → toast "Minimal 1 kolom..." + revert.
   - "Reset default" → semua kembali visible.
   - CRUD action (tambah/edit/verify) → tabel re-render → column visibility tetap konsisten.
3. **Column config — donations:**
   - Same flow di donations page; prefs pengkurban & donations independent.
4. **Multi-user:**
   - Logout user A → login user B di browser yang sama → user B punya defaults sendiri (atau prefs sendiri kalau pernah set).

## Risks / Notes

- `userId` belum dipastikan ada di `getUser()` payload. Cek `auth.service.ts` / JWT payload — kalau belum ada `id`, gunakan `username` sebagai fallback key.
- `localStorage` quota cukup luas (~5MB), prefs object tiny → no quota risk.
- **Forward-compat untuk kolom baru:** kalau ke depan tambah kolom di kode (e.g., tambah "Email" di pengkurban), kolom itu belum ada di `stored` localStorage user existing. Tanpa handling khusus, kolom baru bakal hidden default — bukan UX bagus. **Resolved di design:** `getColumnPrefs` merge `stored` dengan kolom baru dari `defaults`, sehingga kolom baru auto-visible. Trade-off: user yang sengaja hide kolom A bakal melihat kolom A balik kalau kolom B baru ditambah dan kolom A entah bagaimana hilang dari stored (low-likelihood karena stored cuma berubah saat user toggle).
