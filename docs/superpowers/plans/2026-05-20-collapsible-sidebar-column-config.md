# Collapsible Sidebar + Column Visibility Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bikin sidebar di halaman admin bisa di-collapse jadi icon-only, dan beri admin kontrol kolom apa saja yang tampil di tabel pengkurban + donations. Persist preferensi di localStorage per-user.

**Architecture:** Tambah prefs helpers (read/write localStorage) di shared `app.js`. Sidebar collapse di-handle via class `.collapsed` pada `<aside>` + `body`, persist global. Column visibility per-page menggunakan `data-col` attribute pada `<th>`/`<td>` plus CSS `[data-col].col-hidden { display:none }`, toggled lewat popover berisi checkbox.

**Tech Stack:** Vanilla HTML + JS + CSS (no build step), Tailwind via CDN.

**Spec reference:** `docs/superpowers/specs/2026-05-20-collapsible-sidebar-column-config-design.md`

**Note on testing:** Codebase ini ga punya frontend test infrastructure (jest cuma ada untuk NestJS backend). Verifikasi dilakukan manual di browser dengan langkah-langkah eksplisit per task.

---

### Task 1: Buat feature branch dan tambah prefs helpers

**Files:**
- Create: feature branch `feat/collapsible-sidebar-column-config`
- Modify: `client/js/app.js` (append after existing auth helpers, around line 50)

- [ ] **Step 1: Fetch upstream dan buat branch baru**

```bash
git fetch upstream
git checkout -b feat/collapsible-sidebar-column-config upstream/master
```

Expected: `Switched to a new branch 'feat/collapsible-sidebar-column-config'`. Branch start from `upstream/master` per project convention.

- [ ] **Step 2: Tambah prefs helpers ke `client/js/app.js`**

Edit `client/js/app.js`. Setelah `function clearAuth()` (sekitar baris 42-45), append fungsi-fungsi berikut:

```js
// ===== User preferences (localStorage) =====
function _prefsKey() {
  const user = getUser();
  return user ? `prefs:${user.id}` : null;
}

function getPrefs() {
  const key = _prefsKey();
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch (e) {
    console.error('[prefs] parse failed', e.message);
    return {};
  }
}

function setPrefs(patch) {
  const key = _prefsKey();
  if (!key) return;
  const current = getPrefs();
  const next = { ...current, ...patch };
  localStorage.setItem(key, JSON.stringify(next));
}

function getColumnPrefs(page, defaults) {
  const prefs = getPrefs();
  const stored = prefs.columns && prefs.columns[page];
  if (!Array.isArray(stored) || stored.length === 0) return defaults;
  // Defensive: drop unknown columns (defaults may have shrunk).
  const known = stored.filter(id => defaults.includes(id));
  if (known.length === 0) return defaults;
  // Forward-compat: defaults punya kolom baru yang belum di-track -> jadi visible.
  const newOnes = defaults.filter(id => !known.includes(id));
  return [...known, ...newOnes];
}

function setColumnPrefs(page, visibleIds) {
  const prefs = getPrefs();
  setPrefs({ columns: { ...(prefs.columns || {}), [page]: visibleIds } });
}
```

- [ ] **Step 3: Smoke test helper di browser console**

Jalanin `npm run start:dev` (atau cek prod), buka `/dashboard.html` setelah login. Buka DevTools console, ketik:

```js
setPrefs({ test: 42 });
getPrefs(); // expected: { test: 42, ...possibly other keys }
setColumnPrefs('pengkurban', ['regNo', 'aksi']);
getColumnPrefs('pengkurban', ['regNo', 'pendaftar', 'aksi']);
// expected: ['regNo', 'aksi', 'pendaftar']  -- pendaftar appended as forward-compat
localStorage.removeItem(`prefs:${getUser().id}`); // cleanup
```

Expected: outputs sesuai komentar di atas. Jika tidak, debug.

- [ ] **Step 4: Commit**

```bash
git add client/js/app.js
git commit -m "feat(client): add user-prefs helpers backed by localStorage"
```

---

### Task 2: Wrap sidebar nav labels in `<span>` + tambah toggle button + restore state

**Files:**
- Modify: `client/js/app.js:104-141` (function `initSidebar`)
- Modify: `client/css/style.css:443-494` (sidebar block)

- [ ] **Step 1: Wrap label dalam `<span class="nav-label">` di renderer**

Di `client/js/app.js` line 125-132, ubah blok template `nav.innerHTML = navItems.filter(...).map(item => ...)` jadi:

```js
    nav.innerHTML = navItems
      .filter(item => item.roles.includes(user.role))
      .map(item => `
        <a href="${item.href}" class="${activePage === item.id ? 'active' : ''}" id="nav-${item.id}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"/></svg>
          <span class="nav-label">${item.label}</span>
        </a>
      `).join('');

    // Logout
    nav.innerHTML += `
      <a href="#" onclick="logout()" style="margin-top: auto; color: #fca5a5;">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        <span class="nav-label">Logout</span>
      </a>
    `;
```

- [ ] **Step 2: Tambah toggle button di sidebar-logo + restore state di awal `initSidebar`**

Edit `client/js/app.js` function `initSidebar(activePage)`. Setelah `const sidebar = document.getElementById('sidebar');` (line 122), dan SEBELUM `if (sidebar) {`, tambahin restore + inject toggle:

```js
  // Desktop sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    // Restore collapsed state BEFORE rendering (no flash).
    const prefs = getPrefs();
    if (prefs.sidebarCollapsed) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }

    // Inject toggle button into sidebar-logo (one-time).
    const logoEl = sidebar.querySelector('.sidebar-logo');
    if (logoEl && !logoEl.querySelector('.sidebar-toggle')) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-toggle';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Toggle sidebar');
      btn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`;
      btn.onclick = toggleSidebarCollapse;
      logoEl.appendChild(btn);
    }

    const nav = sidebar.querySelector('.sidebar-nav');
    // ... existing nav.innerHTML logic below stays
```

Keep semua line di bawahnya unchanged (the existing `nav.innerHTML = navItems...` block dan logout block dari Step 1 di atas).

- [ ] **Step 3: Tambah function `toggleSidebarCollapse` di `app.js`**

Setelah function `toggleSidebar()` existing (line 184-188), tambahin:

```js
// ===== Desktop sidebar collapse =====
function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  setPrefs({ sidebarCollapsed: collapsed });
}
```

- [ ] **Step 4: Tambah CSS untuk sidebar toggle + collapsed state (desktop)**

Edit `client/css/style.css`. Setelah block `.sidebar-nav a svg { ... }` (sekitar line 494, sebelum `.main-content {`), tambahin:

```css
/* Sidebar logo: anchor untuk toggle button */
.sidebar-logo {
  position: relative;
}
.sidebar-toggle {
  position: absolute;
  top: 0;
  right: 12px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #6ee7b7;
}
.sidebar-toggle svg { width: 16px; height: 16px; }

/* Collapsed state (desktop) */
.sidebar, .main-content { transition: width 0.2s ease, margin-left 0.2s ease; }
.sidebar.collapsed { width: 64px; }
.sidebar.collapsed .sidebar-logo { padding: 0 0 16px; min-height: 36px; }
.sidebar.collapsed .sidebar-logo h1,
.sidebar.collapsed .sidebar-logo p { display: none; }
.sidebar.collapsed .sidebar-toggle { right: 50%; transform: translateX(50%); }
.sidebar.collapsed .sidebar-toggle svg { transform: rotate(180deg); }
.sidebar.collapsed .sidebar-nav a .nav-label { display: none; }
.sidebar.collapsed .sidebar-nav a {
  justify-content: center;
  padding: 12px;
  border-left-width: 0;
}
body.sidebar-collapsed .main-content { margin-left: 64px; }
```

**Why absolute positioning for toggle:** existing `.sidebar-logo` punya `<h1>` + `<p>` sebagai direct children yang stacked vertical. Pakai `position:absolute` untuk toggle button supaya layout h1/p ga ke-disturb. Kalau pakai flex, h1/p jadi flex item dan butuh wrapper extra.

- [ ] **Step 5: Mobile override — collapse jadi no-op**

Edit `client/css/style.css` di block `@media (max-width: 768px)` (sekitar line 692). Lokasinya berisi rules existing seperti `.sidebar { transform: translateX(-100%) }` dan `.sidebar.mobile-open`. Append di dalam media query itu:

```css
  /* Collapse no-op di mobile — sidebar tetap full width saat dibuka via hamburger */
  .sidebar.collapsed { width: 260px; }
  .sidebar.collapsed .sidebar-logo { padding: 0 24px 24px; min-height: auto; }
  .sidebar.collapsed .sidebar-logo h1,
  .sidebar.collapsed .sidebar-logo p { display: block; }
  .sidebar.collapsed .sidebar-nav a .nav-label { display: inline; }
  .sidebar.collapsed .sidebar-nav a {
    justify-content: flex-start;
    padding: 12px 24px;
  }
  .sidebar-toggle { display: none; }
  body.sidebar-collapsed .main-content { margin-left: 0; }
```

- [ ] **Step 6: Commit**

```bash
git add client/js/app.js client/css/style.css
git commit -m "feat(client): collapsible desktop sidebar with persisted state"
```

---

### Task 3: Manual verify — sidebar collapse

- [ ] **Step 1: Start dev server**

```bash
npm run start:dev
```

Wait until `[Nest] ... Application successfully started`.

- [ ] **Step 2: Test sidebar collapse — desktop viewport**

Buka `http://localhost:3000` di browser (>1024px width). Login.

Checks:
- [x] Sidebar tampil full (260px) dengan label.
- [x] Ada tombol chevron `<` di pojok kanan atas sidebar (samping logo).
- [x] Klik tombol → sidebar shrink ke 64px, label hilang, icon tetap visible, chevron icon flip jadi `>`.
- [x] Klik icon nav (e.g., Pengkurban) → tetap navigate ke halaman tersebut.
- [x] Refresh page → sidebar tetap collapsed (state persisted).
- [x] Halaman tetap collapsed saat pindah-pindah pages (dashboard, pengkurban, donations).
- [x] Klik tombol lagi → expand balik, label muncul lagi.

- [ ] **Step 3: Test mobile behavior — resize browser ≤768px**

Resize browser window jadi <768px width.

Checks:
- [x] Sidebar hidden (off-canvas), bottom-nav muncul.
- [x] Toggle button tidak terlihat (di-hide oleh CSS media query).
- [x] Buka hamburger menu (toggleSidebar existing) → sidebar muncul full width, BUKAN collapsed (override mobile).
- [x] Main content margin-left: 0 (tidak ada gap karena sidebar collapse).

Kalau ada issue, fix CSS lalu re-test sebelum lanjut.

---

### Task 4: Tambah popover CSS (shared) di `style.css`

**Files:**
- Modify: `client/css/style.css` (append at end of file)

- [ ] **Step 1: Append popover styles**

Append ke akhir `client/css/style.css`:

```css
/* ===== Column config popover ===== */
.col-config-wrap { position: relative; display: inline-block; }
.col-config-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 50;
  min-width: 220px;
  background: rgba(15, 50, 38, 0.96);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.col-config-popover[hidden] { display: none; }
.col-config-popover h4 {
  font-size: 12px;
  font-weight: 600;
  color: #6ee7b7;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.col-config-popover label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  border-radius: 4px;
}
.col-config-popover label:hover { background: rgba(255, 255, 255, 0.05); }
.col-config-popover input[type="checkbox"] { accent-color: #34d399; }
.col-config-popover-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 8px;
  padding-top: 8px;
}

/* Column hide via data-col attribute */
.data-table [data-col].col-hidden { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add client/css/style.css
git commit -m "style(client): add column-config popover and col-hidden styles"
```

---

### Task 5: Pengkurban — tambah `data-col` + tombol Kolom + popover + applyColumnVisibility

**Files:**
- Modify: `client/pengkurban.html` (header, toolbar, render functions)

- [ ] **Step 1: Tambah `data-col` ke setiap `<th>` di `<thead>`**

Edit `client/pengkurban.html` line 53-65. Replace `<tr>` block dengan:

```html
            <tr>
              <th data-col="regNo">No. Reg</th>
              <th data-col="pendaftar">Nama Pendaftar</th>
              <th data-col="atasNama">Atas Nama Qurban</th>
              <th data-col="jenisHewan">Jenis Hewan</th>
              <th data-col="perkiraanTotal">Perkiraan Total</th>
              <th data-col="alamat">Alamat</th>
              <th data-col="bukti">Bukti</th>
              <th data-col="status">Status</th>
              <th data-col="infaq">Infaq</th>
              <th data-col="konfirmasi">Konfirmasi</th>
              <th data-col="aksi">Aksi</th>
            </tr>
```

- [ ] **Step 2: Update loading/empty row colspan dari 11 → 99**

Cari di `client/pengkurban.html` SEMUA occurence `colspan="11"` (line 68, 353, 375):
- Line 68: `<tr><td colspan="11" class="text-center py-8"><div class="spinner"></div></td></tr>`
- Line 353 (renderGroupHeader): `<td colspan="11" class="font-semibold ...">`
- Line 375 (empty state): `<tr><td colspan="11" ...>Belum ada data pengkurban</td></tr>`

Replace semua `colspan="11"` jadi `colspan="99"`. (Over-sized colspan OK di HTML — browser auto-clamp ke jumlah kolom visible.)

- [ ] **Step 3: Update `renderPengkurbanRow` — tambah `data-col` di setiap `<td>`**

Edit `client/pengkurban.html` line 326-348. Replace seluruh `return <tr>...</tr>` block dengan:

```js
      return `<tr>
        <td data-col="regNo" class="text-xs font-mono text-emerald-300/70">${escHtml(d.registrationNumber || '—')}</td>
        <td data-col="pendaftar"><div class="font-semibold">${escHtml(d.name)}</div>${phoneHtml}</td>
        <td data-col="atasNama" class="text-xs text-white/70">${escHtml(d.shohibulName || '—')}</td>
        <td data-col="jenisHewan">${escHtml(animalLabels[d.animalType] || d.animalType)}</td>
        <td data-col="perkiraanTotal" class="text-xs text-white/70">${computeExpectedTotal(d)}</td>
        <td data-col="alamat">${missing(d.address, '📍')}</td>
        <td data-col="bukti">${proofHtml}</td>
        <td data-col="status"><span class="badge ${statusBadge[d.status] || ''}">${statusLabels[d.status] || d.status}</span></td>
        <td data-col="infaq"><div class="flex flex-col gap-1 items-start">
          ${infaqAmountHtml}
          ${infaqBadge}
        </div></td>
        ${d.konfirmasi_teknis_submitted_at
          ? `<td data-col="konfirmasi" class="text-center" title="Submitted: ${new Date(d.konfirmasi_teknis_submitted_at).toLocaleString('id-ID')}"><button class="text-green-400 hover:text-green-300 cursor-pointer" onclick='openKonfirmasiModal(${escHtml(JSON.stringify(d.id))}, ${escHtml(JSON.stringify(d.name))})'>✓</button></td>`
          : `<td data-col="konfirmasi" class="text-center"><button class="text-white/30 hover:text-yellow-400/70 cursor-pointer text-xs" onclick='openKonfirmasiModal(${escHtml(JSON.stringify(d.id))}, ${escHtml(JSON.stringify(d.name))})'>—</button></td>`}
        <td data-col="aksi"><div class="flex gap-2 flex-wrap">
          ${verifyBtn}
          ${infaqBtn}
          <button class="btn-secondary btn-sm" onclick='editData(${escHtml(JSON.stringify(d))})'>Edit</button>
          <button class="btn-danger btn-sm" onclick="deleteData('${d.id}')">Hapus</button>
        </div></td>
      </tr>`;
```

- [ ] **Step 4: Tambah tombol Kolom + popover markup di toolbar**

Edit `client/pengkurban.html`. Cari toolbar buttons (sekitar line 39-46):

```html
        <button class="btn-secondary" onclick="openRekapModal()">📋 Rekap WA</button>
        <button class="btn-secondary" onclick="exportCsv()">📥 Export CSV</button>
        <button class="btn-primary" onclick="openModal()">
          ...
        </button>
```

Wrap kedua existing button "Rekap WA" + "Export CSV" stay, tapi tambah PERTAMA (paling kiri) sebuah column config wrap:

```html
        <div class="col-config-wrap">
          <button class="btn-secondary" id="col-config-btn" onclick="toggleColumnConfig(event)">⚙ Kolom</button>
          <div class="col-config-popover" id="col-config-popover" hidden>
            <h4>Tampilkan Kolom</h4>
            <div id="col-config-items"></div>
            <div class="col-config-popover-footer">
              <button class="btn-secondary btn-sm" onclick="resetColumnConfig()" style="width:100%">Reset default</button>
            </div>
          </div>
        </div>
        <button class="btn-secondary" onclick="openRekapModal()">📋 Rekap WA</button>
        <button class="btn-secondary" onclick="exportCsv()">📥 Export CSV</button>
```

- [ ] **Step 5: Tambah column registry + JS handlers di `<script>` block**

Edit `client/pengkurban.html`. Cari `<script>` block (sekitar line 175). Setelah declaration awal (sebelum `loadPricingCatalog`), tambah:

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
    const COLUMN_DEFAULTS_PENGKURBAN = COLUMN_DEFS_PENGKURBAN.map(c => c.id);

    function applyColumnVisibilityPengkurban() {
      const visible = getColumnPrefs('pengkurban', COLUMN_DEFAULTS_PENGKURBAN);
      COLUMN_DEFS_PENGKURBAN.forEach(({ id }) => {
        const hidden = !visible.includes(id);
        document.querySelectorAll(`.data-table [data-col="${id}"]`)
          .forEach(el => el.classList.toggle('col-hidden', hidden));
      });
    }

    function renderColumnConfigItems() {
      const visible = getColumnPrefs('pengkurban', COLUMN_DEFAULTS_PENGKURBAN);
      const container = document.getElementById('col-config-items');
      container.innerHTML = COLUMN_DEFS_PENGKURBAN.map(({ id, label }) => `
        <label>
          <input type="checkbox" data-col-id="${id}" ${visible.includes(id) ? 'checked' : ''}>
          <span>${label}</span>
        </label>
      `).join('');
      container.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', onColumnToggle);
      });
    }

    function onColumnToggle(ev) {
      const input = ev.target;
      const allInputs = document.querySelectorAll('#col-config-items input[type="checkbox"]');
      const checkedCount = Array.from(allInputs).filter(i => i.checked).length;
      if (checkedCount === 0) {
        // Revert + warn
        input.checked = true;
        showToast('Minimal 1 kolom harus ditampilkan.', 'error');
        return;
      }
      const visible = Array.from(allInputs)
        .filter(i => i.checked)
        .map(i => i.dataset.colId);
      // Preserve canonical order from COLUMN_DEFAULTS
      const ordered = COLUMN_DEFAULTS_PENGKURBAN.filter(id => visible.includes(id));
      setColumnPrefs('pengkurban', ordered);
      applyColumnVisibilityPengkurban();
    }

    function toggleColumnConfig(ev) {
      ev.stopPropagation();
      const popover = document.getElementById('col-config-popover');
      const wasHidden = popover.hasAttribute('hidden');
      if (wasHidden) {
        renderColumnConfigItems();
        popover.removeAttribute('hidden');
        // Close on outside click (deferred until after this click bubbles)
        setTimeout(() => {
          document.addEventListener('click', closeColumnConfigOnOutsideClick, { once: true });
        }, 0);
      } else {
        popover.setAttribute('hidden', '');
      }
    }

    function closeColumnConfigOnOutsideClick(ev) {
      const popover = document.getElementById('col-config-popover');
      const wrap = popover?.parentElement;
      if (popover && !popover.hasAttribute('hidden') && wrap && !wrap.contains(ev.target)) {
        popover.setAttribute('hidden', '');
      } else if (popover && !popover.hasAttribute('hidden')) {
        // Re-arm listener — click was inside, popover still open
        document.addEventListener('click', closeColumnConfigOnOutsideClick, { once: true });
      }
    }

    function resetColumnConfig() {
      setColumnPrefs('pengkurban', COLUMN_DEFAULTS_PENGKURBAN);
      renderColumnConfigItems();
      applyColumnVisibilityPengkurban();
    }
```

- [ ] **Step 6: Call `applyColumnVisibilityPengkurban()` setelah `tbody.innerHTML = html.join('')`**

Edit `client/pengkurban.html`. Cari line 403 (`tbody.innerHTML = html.join('');`). SETELAH line itu (di dalam function `loadData`), tambah:

```js
        tbody.innerHTML = html.join('');
        applyColumnVisibilityPengkurban();
```

Juga tambah call yang sama setelah baris ini di `loadData()` (sekitar line 375 ada `tbody.innerHTML = '<tr><td colspan="99" ...>Belum ada data...</td></tr>'; return;`). Tepat sebelum `return;`, tambah `applyColumnVisibilityPengkurban();` — supaya empty state juga konsisten dengan visibility (sebenarnya colspan 99 sudah handle, tapi kalau ada modifikasi future, helper ini idempotent).

Actually empty row pakai colspan, hanya 1 td, ga ada data-col. Skip applyColumn pada empty branch.

**Final:** cuma 1 call yang perlu, setelah line `tbody.innerHTML = html.join('');`.

- [ ] **Step 7: Call initial `applyColumnVisibilityPengkurban()` on page load**

Edit `client/pengkurban.html`. Cari handler `DOMContentLoaded` atau initial call ke `loadData()`. Pattern existing kemungkinan:

```js
    document.addEventListener('DOMContentLoaded', () => {
      initSidebar('pengkurban');
      loadPricingCatalog();
      loadData();
    });
```

Tambah call `applyColumnVisibilityPengkurban()` setelah `initSidebar`. Tujuan: header `<th>` perlu di-hide segera, sebelum `loadData()` resolve. Final:

```js
    document.addEventListener('DOMContentLoaded', () => {
      initSidebar('pengkurban');
      applyColumnVisibilityPengkurban();
      loadPricingCatalog();
      loadData();
    });
```

Kalau struktur init beda dari yang di-asumsikan, locate cara existing-nya kick-off page (cari `loadData()` invocation) lalu tambah `applyColumnVisibilityPengkurban()` sebelum/sesudahnya.

- [ ] **Step 8: Commit**

```bash
git add client/pengkurban.html
git commit -m "feat(pengkurban): column visibility config via toolbar popover"
```

---

### Task 6: Manual verify — pengkurban column config

- [ ] **Step 1: Server masih jalan? Kalau belum: `npm run start:dev`**

- [ ] **Step 2: Buka `/pengkurban.html`, login kalau perlu**

Checks:
- [x] Tombol `⚙ Kolom` muncul di toolbar, paling kiri (sebelum "📋 Rekap WA").
- [x] Klik tombol → popover muncul di bawah tombol, berisi 11 checkbox dengan semua checked.
- [x] Uncheck "Alamat" → kolom Alamat hilang di header `<th>` DAN di setiap row. Tabel tidak collapse / layout tetap rapi.
- [x] Uncheck "Bukti", "Infaq", "Konfirmasi" → semua hilang, sisanya tetap visible.
- [x] Reload page → kolom yang di-uncheck tetap hidden (state persisted).
- [x] Uncheck terus sampai sisa 1 checkbox checked → uncheck checkbox terakhir → toast error "Minimal 1 kolom..." muncul + checkbox auto-revert (tetap checked).
- [x] Klik "Reset default" → semua kolom muncul lagi, semua checkbox checked.
- [x] Klik area di luar popover (e.g., background atau row tabel) → popover close.
- [x] Klik di dalam popover (e.g., area kosong di popover) → popover tetap open.
- [x] Lakukan action seperti "Edit" sebuah row → tabel re-render → column visibility tetap konsisten (kolom yang di-hide tetap hidden setelah re-render).
- [x] Klik "📥 Export CSV" → CSV download tetap berisi semua kolom (export ga di-affect oleh visibility, by design).

- [ ] **Step 3: Cleanup data uji**

Buka DevTools console:
```js
localStorage.removeItem(`prefs:${getUser().id}`);
```
Refresh — semua kolom kembali visible.

Kalau ada issue, fix lalu re-test.

---

### Task 7: Donations — mirror pattern dari pengkurban

**Files:**
- Modify: `client/donations.html`

- [ ] **Step 1: Tambah `data-col` ke `<th>`**

Edit `client/donations.html` line 63-71. Replace block dengan:

```html
            <tr>
              <th data-col="nama">Nama</th>
              <th data-col="noWa">No. WA</th>
              <th data-col="nominal">Nominal</th>
              <th data-col="bukti">Bukti</th>
              <th data-col="status">Status</th>
              <th data-col="waktu">Waktu</th>
              <th data-col="aksi">Aksi</th>
            </tr>
```

- [ ] **Step 2: Ganti `colspan="7"` jadi `colspan="99"`**

Cari di `client/donations.html`: `colspan="7"` (line 74, 160). Replace semua jadi `colspan="99"`.

- [ ] **Step 3: Tambah `data-col` ke `<td>` dalam renderer**

Edit `client/donations.html` line 175-186. Replace return template dengan:

```js
          return `<tr>
            <td data-col="nama" class="font-semibold">${escHtml(d.name)}</td>
            <td data-col="noWa">${escHtml(d.phone || '—')}</td>
            <td data-col="nominal">${d.amount != null ? 'Rp ' + Number(d.amount).toLocaleString('id-ID') : '<span class="text-white/30">Seikhlasnya</span>'}</td>
            <td data-col="bukti">${proofHtml}</td>
            <td data-col="status"><span class="badge ${statusBadge[d.status] || ''}">${statusLabels[d.status] || d.status}</span></td>
            <td data-col="waktu" class="text-xs text-white/50">${formatDate(d.createdAt)}</td>
            <td data-col="aksi"><div class="flex gap-2">
              ${verifyBtn}
              <button class="btn-danger btn-sm" onclick="deleteData('${d.id}')">Hapus</button>
            </div></td>
          </tr>`;
```

- [ ] **Step 4: Tambah tombol Kolom + popover markup di toolbar**

Locate toolbar di `client/donations.html` (cari div yang punya "Export CSV" button — sekitar line 40-55, struktur mirip pengkurban). Tambah PALING KIRI block ini:

```html
        <div class="col-config-wrap">
          <button class="btn-secondary" id="col-config-btn" onclick="toggleColumnConfig(event)">⚙ Kolom</button>
          <div class="col-config-popover" id="col-config-popover" hidden>
            <h4>Tampilkan Kolom</h4>
            <div id="col-config-items"></div>
            <div class="col-config-popover-footer">
              <button class="btn-secondary btn-sm" onclick="resetColumnConfig()" style="width:100%">Reset default</button>
            </div>
          </div>
        </div>
```

Kalau struktur toolbar belum jelas, locate dulu dengan: `grep -n "Export CSV\|class=\"btn-secondary\"" client/donations.html`.

- [ ] **Step 5: Tambah column registry + handlers di `<script>`**

Edit `client/donations.html`. Cari `<script>` block, tambah di awal scope (sebelum first function declaration):

```js
    const COLUMN_DEFS_DONATIONS = [
      { id: 'nama', label: 'Nama' },
      { id: 'noWa', label: 'No. WA' },
      { id: 'nominal', label: 'Nominal' },
      { id: 'bukti', label: 'Bukti' },
      { id: 'status', label: 'Status' },
      { id: 'waktu', label: 'Waktu' },
      { id: 'aksi', label: 'Aksi' },
    ];
    const COLUMN_DEFAULTS_DONATIONS = COLUMN_DEFS_DONATIONS.map(c => c.id);

    function applyColumnVisibilityDonations() {
      const visible = getColumnPrefs('donations', COLUMN_DEFAULTS_DONATIONS);
      COLUMN_DEFS_DONATIONS.forEach(({ id }) => {
        const hidden = !visible.includes(id);
        document.querySelectorAll(`.data-table [data-col="${id}"]`)
          .forEach(el => el.classList.toggle('col-hidden', hidden));
      });
    }

    function renderColumnConfigItems() {
      const visible = getColumnPrefs('donations', COLUMN_DEFAULTS_DONATIONS);
      const container = document.getElementById('col-config-items');
      container.innerHTML = COLUMN_DEFS_DONATIONS.map(({ id, label }) => `
        <label>
          <input type="checkbox" data-col-id="${id}" ${visible.includes(id) ? 'checked' : ''}>
          <span>${label}</span>
        </label>
      `).join('');
      container.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', onColumnToggle);
      });
    }

    function onColumnToggle(ev) {
      const input = ev.target;
      const allInputs = document.querySelectorAll('#col-config-items input[type="checkbox"]');
      const checkedCount = Array.from(allInputs).filter(i => i.checked).length;
      if (checkedCount === 0) {
        input.checked = true;
        showToast('Minimal 1 kolom harus ditampilkan.', 'error');
        return;
      }
      const visible = Array.from(allInputs)
        .filter(i => i.checked)
        .map(i => i.dataset.colId);
      const ordered = COLUMN_DEFAULTS_DONATIONS.filter(id => visible.includes(id));
      setColumnPrefs('donations', ordered);
      applyColumnVisibilityDonations();
    }

    function toggleColumnConfig(ev) {
      ev.stopPropagation();
      const popover = document.getElementById('col-config-popover');
      const wasHidden = popover.hasAttribute('hidden');
      if (wasHidden) {
        renderColumnConfigItems();
        popover.removeAttribute('hidden');
        setTimeout(() => {
          document.addEventListener('click', closeColumnConfigOnOutsideClick, { once: true });
        }, 0);
      } else {
        popover.setAttribute('hidden', '');
      }
    }

    function closeColumnConfigOnOutsideClick(ev) {
      const popover = document.getElementById('col-config-popover');
      const wrap = popover?.parentElement;
      if (popover && !popover.hasAttribute('hidden') && wrap && !wrap.contains(ev.target)) {
        popover.setAttribute('hidden', '');
      } else if (popover && !popover.hasAttribute('hidden')) {
        document.addEventListener('click', closeColumnConfigOnOutsideClick, { once: true });
      }
    }

    function resetColumnConfig() {
      setColumnPrefs('donations', COLUMN_DEFAULTS_DONATIONS);
      renderColumnConfigItems();
      applyColumnVisibilityDonations();
    }
```

- [ ] **Step 6: Hook ke render flow**

Edit `client/donations.html`:

1. Setelah `tbody.innerHTML = data.map(...).join('');` (sekitar line 187), tambah:
   ```js
           applyColumnVisibilityDonations();
   ```

2. Di `DOMContentLoaded` handler, tambah call:
   ```js
       document.addEventListener('DOMContentLoaded', () => {
         initSidebar('donations');
         applyColumnVisibilityDonations();
         loadData();  // atau apa pun existing initial load
       });
   ```

Locate dengan: `grep -n "DOMContentLoaded\|initSidebar" client/donations.html`.

- [ ] **Step 7: Commit**

```bash
git add client/donations.html
git commit -m "feat(donations): column visibility config via toolbar popover"
```

---

### Task 8: Manual verify — donations + cross-page persistence

- [ ] **Step 1: Buka `/donations.html`**

Checks (mirror pengkurban):
- [x] Tombol `⚙ Kolom` muncul, klik buka popover dengan 7 checkbox (semua checked).
- [x] Uncheck "Waktu" → kolom hilang di header + row.
- [x] Reload → tetap persist.
- [x] Uncheck semua kecuali 1 → toast muncul saat uncheck terakhir.
- [x] Reset default → semua muncul lagi.
- [x] Outside click close popover.

- [ ] **Step 2: Cross-page persistence**

- Buka `/pengkurban.html`, uncheck "Alamat" + "Konfirmasi".
- Pindah ke `/donations.html`, uncheck "Waktu".
- Pindah balik ke `/pengkurban.html` — verify Alamat + Konfirmasi masih hidden, kolom lain masih visible (state tidak ketuker dengan donations).
- Pindah ke `/donations.html` — verify hanya Waktu yang hidden.

- [ ] **Step 3: Verify storage shape di DevTools**

Di console:
```js
JSON.parse(localStorage.getItem(`prefs:${getUser().id}`));
```

Expected output:
```js
{
  sidebarCollapsed: false /* or true */,
  columns: {
    pengkurban: ['regNo', 'pendaftar', 'atasNama', 'jenisHewan', 'perkiraanTotal', 'bukti', 'status', 'infaq', 'aksi'],
    donations: ['nama', 'noWa', 'nominal', 'bukti', 'status', 'aksi']
  }
}
```

(Exact contents depend on what user toggled. Verify structure matches.)

- [ ] **Step 4: Multi-user namespacing test (optional)**

- Logout dari user current.
- Login pakai user lain (kalau ada credential lain).
- Verify user kedua tampil dengan semua kolom default (preference user pertama ga "leak").
- Cek DevTools console: ada 2 key `prefs:<id1>` dan `prefs:<id2>`.

- [ ] **Step 5: Cleanup**

Logout, atau bersihkan localStorage manual.

---

### Task 9: Final regression check + push

- [ ] **Step 1: Smoke test halaman lain (sidebar collapse ga rusak existing pages)**

Untuk masing-masing halaman post-login, login dan verify halaman load tanpa error:
- `/dashboard.html` — stats tampil, sidebar collapse works.
- `/events.html` — events list, sidebar OK.
- `/users.html` (SUPER_ADMIN) — users list, sidebar OK.
- `/vouchers.html` — voucher list, sidebar OK.
- `/scanner.html` — scanner UI loads, sidebar OK.
- `/activity-logs.html` — log list, sidebar OK.
- `/analytics.html` — stats, sidebar OK.

Untuk setiap halaman: collapse sidebar, refresh, expect collapsed persist. Expand, refresh, expect expanded persist. Tidak ada console error di DevTools.

- [ ] **Step 2: Lint / format check**

```bash
npm run lint
```

Expected: no new errors. Fix kalau ada warnings yang relevan.

- [ ] **Step 3: Push ke `origin` (fork Fajar)**

Per project memory `feedback_pr_to_own_fork.md`: default push ke `origin` (fajarmf/panitia-kurban), TIDAK buat PR ke upstream.

```bash
git push -u origin feat/collapsible-sidebar-column-config
```

Expected: branch pushed, no PR auto-created.

- [ ] **Step 4: Summary**

Report back ke user:
- Branch pushed: `feat/collapsible-sidebar-column-config`
- Files changed: `client/js/app.js`, `client/css/style.css`, `client/pengkurban.html`, `client/donations.html`
- Manual verification: all checks pass
- Tidak buat PR ke upstream (per preference)

---

## Notes for the implementer

- **Existing code preservation:** Jangan refactor logic existing yang ga related (e.g., `renderPengkurbanRow` punya banyak helper var seperti `infaqAmountHtml`, `phoneHtml` — biarkan). Cuma tambah `data-col` attribute.
- **`escHtml`:** sudah tersedia di scope `pengkurban.html` dan `donations.html`. Pakai untuk semua user-supplied content (sudah dipakai existing code).
- **`showToast`:** sudah tersedia globally via `app.js`. Pakai untuk error feedback di popover.
- **Toast type:** dukung `'error'` (lihat `app.js` showToast implementation kalau ragu).
- **Don't add Co-Authored-By** di commit message (per project convention).
- **Indonesian/English mix** di commit message acceptable.
