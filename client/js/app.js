// ===== Visit Tracking =====
function trackVisit(page) {
  let sessionId = localStorage.getItem('_sid');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('_sid', sessionId);
  }
  const body = { page, sessionId, referrer: document.referrer || undefined };
  fetch('/api/public/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// ===== API Helper & Auth Utilities =====
const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  const u = localStorage.getItem('user');
  return u ? JSON.parse(u) : null;
}

function setAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// ===== User preferences (localStorage) =====
function _prefsKey() {
  const user = getUser();
  return user ? `prefs:${user.id}` : null;
}

function getPrefs() {
  try {
    const key = _prefsKey();
    if (!key) return {};
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch (e) {
    console.error('[prefs] parse failed', e.message);
    return {};
  }
}

function setPrefs(patch) {
  try {
    const key = _prefsKey();
    if (!key) return;
    const current = getPrefs();
    const next = { ...current, ...patch };
    localStorage.setItem(key, JSON.stringify(next));
  } catch (e) {
    console.error('[prefs] write failed', e.message);
  }
}

function getColumnPrefs(page, defaults) {
  const prefs = getPrefs();
  const stored = prefs.columns && prefs.columns[page];
  if (!Array.isArray(stored) || stored.length === 0) return defaults;
  // Defensive: drop unknown columns (defaults may have shrunk).
  // Note: NOT merging with defaults — stored is the source of truth for
  // what user wants visible. Merging would re-add columns user explicitly hid.
  // New columns added later can be surfaced via "Reset default".
  const known = stored.filter(id => defaults.includes(id));
  return known.length > 0 ? known : defaults;
}

function setColumnPrefs(page, visibleIds) {
  const prefs = getPrefs();
  setPrefs({ columns: { ...(prefs.columns || {}), [page]: visibleIds } });
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function hasRole(...roles) {
  const user = getUser();
  return user && roles.includes(user.role);
}

async function api(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
      clearAuth();
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
      }
      throw new Error('Username atau password salah');
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/pdf')) {
      if (!res.ok) throw new Error('PDF generation failed');
      return res.blob();
    }
    const text = await res.text();
    if (!res.ok) {
      let errorMsg = 'Request failed';
      try {
        const errData = JSON.parse(text);
        errorMsg = errData.message || errorMsg;
      } catch (e) { }
      throw new Error(errorMsg);
    }
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    throw err;
  }
}

// ===== Toast =====
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ===== Sidebar Navigation =====
function initSidebar(activePage) {
  const user = getUser();
  if (!user) return;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4', roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER', 'PANITIA_SCANNER'] },
    { id: 'events', label: 'Event', href: '/events.html', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA'] },
    { id: 'pengkurban', label: 'Pengkurban', href: '/pengkurban.html', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER'] },
    { id: 'donations', label: 'Sumbangan', href: '/donations.html', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER'] },
    { id: 'vouchers', label: 'Voucher', href: '/vouchers.html', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER'] },
    { id: 'animals', label: 'Hewan', href: '/animals.html', icon: 'M3 10h11M9 21V3m5 18V3m-5 6h5M9 9h5M3 14h11M14 3v18m5-15v12a3 3 0 01-3 3H5a3 3 0 01-3-3V6a3 3 0 013-3h11a3 3 0 013 3z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER', 'PANITIA_SCANNER'] },
    { id: 'scanner', label: 'Scanner QR', href: '/scanner.html', icon: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_SCANNER'] },
    { id: 'users', label: 'Kelola User', href: '/users.html', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m9 5.197V21', roles: ['SUPER_ADMIN'] },
    { id: 'analytics', label: 'Statistik', href: '/analytics.html', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA'] },
    { id: 'activity-logs', label: 'Log Aktivitas', href: '/activity-logs.html', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', roles: ['SUPER_ADMIN', 'KETUA_PANITIA'] },
  ];

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
  }

  // Mobile bottom nav
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    const items = bottomNav.querySelector('.bottom-nav-items');
    const mobileItems = navItems
      .filter(item => item.roles.includes(user.role))
      .slice(0, 5); // Max 5 items for bottom nav
    items.innerHTML = mobileItems
      .map(item => `
        <a href="${item.href}" class="bottom-nav-item ${activePage === item.id ? 'active' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"/></svg>
          ${item.label}
        </a>
      `).join('');
  }

  // User info in top bar
  const userInfo = document.getElementById('user-info');
  if (userInfo) {
    const initials = user.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const roleLabels = {
      'SUPER_ADMIN': 'Super Admin',
      'KETUA_PANITIA': 'Ketua Panitia',
      'PANITIA_VOUCHER': 'Panitia Voucher',
      'PANITIA_SCANNER': 'Panitia Scanner'
    };
    userInfo.innerHTML = `
      <div>
        <div class="user-name">${user.fullName}</div>
        <div class="user-role">${roleLabels[user.role] || user.role}</div>
      </div>
      <div class="user-avatar">${initials}</div>
    `;
  }
}

function logout() {
  clearAuth();
  window.location.href = '/login.html';
}

// ===== Mobile sidebar toggle =====
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('mobile-open');
}

// ===== Desktop sidebar collapse =====
function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  setPrefs({ sidebarCollapsed: collapsed });
}

// ===== Format date =====
function formatDate(dateStr) {
  if (!dateStr) return '-';
  // Handle date-only strings (YYYY-MM-DD) from PostgreSQL
  const str = String(dateStr);
  const d = str.length === 10 ? new Date(str + 'T12:00:00') : new Date(str);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('id-ID', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ===== Confirm dialog =====
function confirmAction(message) {
  return confirm(message);
}

// ===== Proof image lightbox =====
function showLightbox(src) {
  let overlay = document.getElementById('lightbox-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
      <button class="lightbox-close" onclick="closeLightbox()">✕</button>
      <img id="lightbox-img" src="" alt="Bukti pembayaran">
    `;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeLightbox();
    });
    document.body.appendChild(overlay);
  }
  document.getElementById('lightbox-img').src = src;
  overlay.classList.add('active');
}

function closeLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ===== Event selector helper =====
async function loadEventOptions(selectId, includeAll = false) {
  try {
    const events = await api('/events');
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = includeAll ? '<option value="">Semua Event</option>' : '<option value="">Pilih Event</option>';
    events.forEach(e => {
      select.innerHTML += `<option value="${e.id}" ${e.isActive ? 'selected' : ''}>${e.name} (${e.year})</option>`;
    });
    return events;
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}
