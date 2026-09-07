// ===== Zustand =====
let session = JSON.parse(localStorage.getItem('session') || 'null'); // {token, name, role, code}
let reservations = [];
let currentDetailId = null;

// ===== Helfer =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const euro = (n) => (n === null || n === undefined ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n));
const fmtDate = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const STATUS_LABEL = { offen: 'Offen', bezahlt: 'Bezahlt', storniert: 'Storniert', abgeholt: 'Abgeholt' };

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler');
  return data;
}

// ===== Auth: Umschalten zwischen den Login-Schritten =====
$$('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.auth-step').forEach((f) => f.classList.add('hidden'));
    $(`#${btn.dataset.goto.replace('-step', '-form')}`).classList.remove('hidden');
  });
});

function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $$('.auth-step').forEach((f) => f.classList.add('hidden'));
  $('#login-form').classList.remove('hidden');
}

function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#current-user').textContent = `${session.name} (${session.role === 'owner' ? 'Inhaber' : 'Mitarbeiter'})`;
  $('#nav-employees').classList.toggle('hidden', session.role !== 'owner');
  loadReservations();
  loadInbox();
  if (session.role === 'owner') loadEmployees();
}

function saveSession(data) {
  session = data;
  localStorage.setItem('session', JSON.stringify(session));
  showApp();
}

// ----- Anmelden -----
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#login-code').value.trim();
  const password = $('#login-password').value;
  const btn = $('#login-btn');
  const errorEl = $('#login-error');
  errorEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Wird geprüft…';
  try {
    const data = await api('auth-login', { method: 'POST', body: { code, password } });
    saveSession(data);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Anmelden';
  }
});

// ----- Erstmaliges Passwort festlegen -----
$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#setup-code').value.trim();
  const password = $('#setup-password').value;
  const btn = $('#setup-btn');
  const errorEl = $('#setup-error');
  errorEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Wird gespeichert…';
  try {
    const data = await api('auth-setup-password', { method: 'POST', body: { code, password } });
    saveSession(data);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Passwort festlegen';
  }
});

// ----- Passwort vergessen: Code anfordern -----
$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#forgot-code').value.trim();
  const btn = $('#forgot-btn');
  const errorEl = $('#forgot-error');
  const successEl = $('#forgot-success');
  errorEl.textContent = ''; successEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Wird gesendet…';
  try {
    const data = await api('auth-forgot-password', { method: 'POST', body: { code } });
    successEl.textContent = data.message;
    $('#reset-code-input').value = code;
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Code anfordern';
  }
});

// ----- Passwort mit Code zurücksetzen -----
$('#reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#reset-code-input').value.trim();
  const resetCode = $('#reset-code').value.trim();
  const newPassword = $('#reset-password').value;
  const btn = $('#reset-btn');
  const errorEl = $('#reset-error');
  errorEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Wird geändert…';
  try {
    await api('auth-reset-password', { method: 'POST', body: { code, resetCode, newPassword } });
    $$('.auth-step').forEach((f) => f.classList.add('hidden'));
    $('#login-form').classList.remove('hidden');
    $('#login-code').value = code;
    $('#login-error').textContent = 'Passwort geändert — bitte anmelden.';
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Passwort ändern';
  }
});

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('session');
  session = null;
  showLogin();
});

// ===== Navigation =====
$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $(`#view-${view}`).classList.remove('hidden');
    if (view === 'inbox') loadInbox();
    if (view === 'employees') loadEmployees();
    if (view === 'profile') renderProfile();
  });
});

function renderProfile() {
  const isOwner = session.role === 'owner';
  $('#profile-content').innerHTML = `
    <div class="detail-grid">
      <div><span class="muted">Name</span><br>${escapeHtml(session.name)}</div>
      <div><span class="muted">Zugangscode</span><br>${escapeHtml(session.code)}</div>
      <div><span class="muted">Rolle</span><br>${isOwner ? 'Inhaber' : 'Mitarbeiter'}</div>
      <div><span class="muted">Lohn</span><br>${session.salary !== undefined ? euro(session.salary) : '– (siehe Mitarbeiterliste)'}</div>
    </div>
  `;
}

// ===== Reservierungen =====
async function loadReservations() {
  try {
    const data = await api('reservations');
    reservations = data.reservations || [];
    renderReservations(reservations);
  } catch (err) {
    console.error(err);
  }
}

function renderReservations(list) {
  const body = $('#res-table-body');
  body.innerHTML = '';
  $('#res-count').textContent = `${list.length} Reservierung${list.length === 1 ? '' : 'en'}`;
  $('#res-empty').classList.toggle('hidden', list.length !== 0);

  list.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(r.reservation_number)}</td>
      <td>${escapeHtml(r.product)}</td>
      <td>${escapeHtml(r.customer_name)}</td>
      <td class="muted">${escapeHtml(r.customer_email)}${r.customer_phone ? '<br>' + escapeHtml(r.customer_phone) : ''}</td>
      <td>${r.quantity}</td>
      <td>${euro(r.price)}</td>
      <td><span class="status-badge status-${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
    `;
    tr.addEventListener('click', () => openDetail(r.id));
    body.appendChild(tr);
  });
}

$('#search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) return renderReservations(reservations);
  renderReservations(
    reservations.filter((r) =>
      [r.reservation_number, r.product, r.customer_name, r.customer_email].join(' ').toLowerCase().includes(q)
    )
  );
});

// ----- Neue Reservierung -----
$('#new-reservation-btn').addEventListener('click', () => $('#new-res-overlay').classList.remove('hidden'));
$('#new-res-cancel').addEventListener('click', () => $('#new-res-overlay').classList.add('hidden'));

$('#new-res-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('reservations', {
      method: 'POST',
      body: {
        product: fd.get('product'),
        reservation_number: fd.get('reservation_number'),
        customer_name: fd.get('customer_name'),
        customer_email: fd.get('customer_email'),
        customer_phone: fd.get('customer_phone') || null,
        quantity: parseInt(fd.get('quantity'), 10),
        price: parseFloat(fd.get('price')),
        notes: fd.get('notes') || null,
      },
    });
    e.target.reset();
    $('#new-res-overlay').classList.add('hidden');
    loadReservations();
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
});

// ===== Detailansicht mit E-Mail-Verlauf =====
async function openDetail(id) {
  currentDetailId = id;
  const r = reservations.find((x) => x.id === id);
  if (!r) return;

  $('#detail-content').innerHTML = `
    <h2>${escapeHtml(r.product)}</h2>
    <p class="mono muted">${escapeHtml(r.reservation_number)}</p>
    <div class="detail-grid">
      <div><span class="muted">Kunde</span><br>${escapeHtml(r.customer_name)}</div>
      <div><span class="muted">E-Mail</span><br>${escapeHtml(r.customer_email)}</div>
      <div><span class="muted">Telefon</span><br>${escapeHtml(r.customer_phone) || '–'}</div>
      <div><span class="muted">Stück / Preis</span><br>${r.quantity} × ${euro(r.price)}</div>
    </div>
    <label class="status-select-label">Status
      <select id="status-select">
        ${Object.entries(STATUS_LABEL).map(([val, label]) => `<option value="${val}" ${r.status === val ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </label>
    ${r.notes ? `<p class="notes-box">${escapeHtml(r.notes)}</p>` : ''}
    <hr class="divider" />
    <h3>E-Mail-Verlauf</h3>
    <div id="email-thread" class="email-thread"><p class="muted">Lade…</p></div>
    <form id="compose-form" class="compose-form">
      <input type="text" id="compose-subject" placeholder="Betreff" required />
      <textarea id="compose-body" rows="4" placeholder="Nachricht…" required></textarea>
      <button type="submit" class="btn-primary" id="compose-send-btn">Senden</button>
      <p id="compose-error" class="error-text"></p>
    </form>
  `;

  $('#status-select').addEventListener('change', async (e) => {
    await api('reservations', { method: 'PATCH', body: { id, status: e.target.value } });
    loadReservations();
  });

  $('#compose-form').addEventListener('submit', (e) => sendEmail(e, r));
  $('#detail-overlay').classList.remove('hidden');
  loadEmailThread(id);
}

$('#detail-close').addEventListener('click', () => $('#detail-overlay').classList.add('hidden'));

async function loadEmailThread(reservationId) {
  const el = $('#email-thread');
  try {
    const data = await api(`emails?reservation_id=${reservationId}`);
    const list = data.emails || [];
    if (!list.length) {
      el.innerHTML = `<p class="muted">Noch keine E-Mails zu dieser Reservierung.</p>`;
      return;
    }
    el.innerHTML = list.map((m) => `
      <div class="email-item email-${m.direction}">
        <div class="email-meta">
          <strong>${m.direction === 'out' ? 'Gesendet' : 'Empfangen'}</strong>
          <span class="muted">${fmtDate(m.created_at)}</span>
        </div>
        <div class="email-subject">${escapeHtml(m.subject)}</div>
        <div class="email-body">${escapeHtml(m.body)}</div>
      </div>`).join('');

    const unread = list.filter((m) => m.direction === 'in' && !m.is_read).map((m) => m.id);
    if (unread.length) {
      await api('emails', { method: 'PATCH', body: { ids: unread } });
      loadInbox();
    }
  } catch (err) {
    el.innerHTML = `<p class="error-text">Konnte E-Mails nicht laden.</p>`;
  }
}

async function sendEmail(e, reservation) {
  e.preventDefault();
  const subject = $('#compose-subject').value.trim();
  const body = $('#compose-body').value.trim();
  const btn = $('#compose-send-btn');
  const errorEl = $('#compose-error');
  errorEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Wird gesendet…';
  try {
    await api('send-email', { method: 'POST', body: { to: reservation.customer_email, subject, body, reservationId: reservation.id } });
    $('#compose-subject').value = '';
    $('#compose-body').value = '';
    loadEmailThread(reservation.id);
  } catch (err) {
    errorEl.textContent = 'Senden fehlgeschlagen: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Senden';
  }
}

// ===== Posteingang =====
async function loadInbox() {
  try {
    const data = await api('emails');
    const list = data.emails || [];
    const unreadCount = list.filter((m) => !m.is_read).length;
    const badge = $('#inbox-badge');
    badge.textContent = unreadCount;
    badge.classList.toggle('hidden', unreadCount === 0);

    $('#inbox-empty').classList.toggle('hidden', list.length !== 0);
    $('#inbox-list').innerHTML = list.map((m) => `
      <div class="inbox-item ${m.is_read ? '' : 'unread'}">
        <div class="email-meta">
          <strong>${escapeHtml(m.from_address)}</strong>
          <span class="muted">${fmtDate(m.created_at)}</span>
        </div>
        <div class="email-subject">${escapeHtml(m.subject)}</div>
        <div class="email-body">${escapeHtml(m.body)}</div>
      </div>`).join('');
  } catch (err) {
    console.error(err);
  }
}

// ===== Mitarbeiterverwaltung (Owner) =====
async function loadEmployees() {
  if (session.role !== 'owner') return;
  try {
    const data = await api('employees');
    renderEmployees(data.employees || [], data.resetRequests || []);
  } catch (err) {
    console.error(err);
  }
}

function renderEmployees(list, resetRequests) {
  const badge = $('#reset-badge');
  badge.textContent = resetRequests.length;
  badge.classList.toggle('hidden', resetRequests.length === 0);

  const box = $('#reset-requests-box');
  box.classList.toggle('hidden', resetRequests.length === 0);
  $('#reset-requests-list').innerHTML = resetRequests.map((req) => {
    const emp = list.find((e) => e.id === req.employee_id);
    return `<div class="reset-request-item">
      <strong>${escapeHtml(emp ? emp.name : '?')}</strong> (${escapeHtml(emp ? emp.employee_code : '?')})
      → Code: <span class="mono reset-code">${req.reset_code}</span>
      <span class="muted">gültig bis ${fmtDate(req.expires_at)}</span>
    </div>`;
  }).join('');

  $('#employees-table-body').innerHTML = list.map((e) => `
    <tr>
      <td class="mono">${escapeHtml(e.employee_code)}</td>
      <td>${escapeHtml(e.name)}</td>
      <td>${e.role === 'owner' ? 'Inhaber' : 'Mitarbeiter'}</td>
      <td class="mono">${euro(e.salary)}</td>
      <td>${e.has_password ? '<span class="status-badge status-bezahlt">Aktiv</span>' : '<span class="status-badge status-offen">Wartet auf Passwort</span>'}</td>
      <td>
        <button class="link-btn" data-emp-action="salary" data-id="${e.id}">Lohn ändern</button>
        <button class="link-btn" data-emp-action="password" data-id="${e.id}">Passwort setzen</button>
        ${e.role !== 'owner' ? `<button class="link-btn" data-emp-action="delete" data-id="${e.id}">Löschen</button>` : ''}
      </td>
    </tr>
  `).join('');

  $$('[data-emp-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleEmployeeAction(btn.dataset.empAction, btn.dataset.id, list));
  });
}

async function handleEmployeeAction(action, id, list) {
  const emp = list.find((e) => e.id === id);
  if (action === 'salary') {
    const value = prompt(`Neuer Lohn für ${emp.name} (€):`, emp.salary || '');
    if (value === null) return;
    try {
      await api('employees', { method: 'PATCH', body: { id, salary: parseFloat(value) || null } });
      loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  }
  if (action === 'password') {
    const value = prompt(`Neues Passwort für ${emp.name} (min. 8 Zeichen):`);
    if (!value) return;
    try {
      await api('employees', { method: 'PATCH', body: { id, newPassword: value } });
      alert('Passwort gesetzt. Bitte dem Mitarbeiter mitteilen.');
      loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  }
  if (action === 'delete') {
    if (!confirm(`${emp.name} wirklich löschen?`)) return;
    try {
      await api('employees', { method: 'DELETE', body: { id } });
      loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  }
}

$('#new-employee-btn').addEventListener('click', () => $('#new-emp-overlay').classList.remove('hidden'));
$('#new-emp-cancel').addEventListener('click', () => $('#new-emp-overlay').classList.add('hidden'));

$('#new-emp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('employees', {
      method: 'POST',
      body: {
        employee_code: fd.get('employee_code'),
        name: fd.get('name'),
        salary: fd.get('salary') ? parseFloat(fd.get('salary')) : null,
      },
    });
    e.target.reset();
    $('#new-emp-overlay').classList.add('hidden');
    loadEmployees();
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
});

// ===== Start =====
if (session) showApp(); else showLogin();
