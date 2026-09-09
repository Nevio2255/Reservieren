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

// E-Mail-Vorlagen werden jetzt aus der Datenbank geladen (siehe loadTemplates()).
// {{platzhalter}} werden automatisch mit den Reservierungsdaten gefüllt.
let emailTemplates = [];

function fillTemplate(str, r, extra = {}) {
  const total = euro((r.price || 0) * (r.quantity || 1));
  return str
    .replaceAll('{{customer_name}}', r.customer_name || '')
    .replaceAll('{{product}}', r.product || '')
    .replaceAll('{{reservation_number}}', r.reservation_number || '')
    .replaceAll('{{quantity}}', r.quantity ?? '')
    .replaceAll('{{total}}', total)
    .replaceAll('{{chat_link}}', extra.chatLink || '');
}

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
  $('#nav-templates').classList.toggle('hidden', session.role !== 'owner');
  $('#export-csv-btn').classList.toggle('hidden', session.role !== 'owner');
  loadReservations();
  loadInbox();
  loadTemplates();
  loadLiveChats();
  if (session.role === 'owner') loadEmployees();
  requestNotificationPermission();
  startLiveChatGlobalPolling();
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
  clearInterval(liveChatGlobalPollTimer);
  notifiedJoinedChatIds = null;
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
    if (view === 'templates') loadTemplates();
    if (view === 'livechats') {
      loadLiveChats();
      btn.classList.remove('has-new-join'); // Beitritts-Hinweis verschwindet, sobald man reinschaut
    }
    if (view === 'profile') renderProfile();
  });
});

function renderProfile() {
  const isOwner = session.role === 'owner';
  const myCount = reservations.filter((r) => r.created_by === session.name).length;
  const totalRevenue = reservations.reduce((sum, r) => sum + (r.price || 0) * (r.quantity || 1), 0);

  $('#profile-content').innerHTML = `
    <div class="detail-grid">
      <div><span class="muted">Name</span><br>${escapeHtml(session.name)}</div>
      <div><span class="muted">Zugangscode</span><br>${escapeHtml(session.code)}</div>
      <div><span class="muted">Rolle</span><br>${isOwner ? 'Inhaber' : 'Mitarbeiter'}</div>
    </div>
    <hr class="divider" />
    <div class="stats-row" style="margin:0;">
      <div class="stat-card">
        <div class="stat-value">${myCount}</div>
        <div class="stat-label">von mir angelegte Reservierungen</div>
      </div>
      ${isOwner ? `<div class="stat-card"><div class="stat-value">${euro(totalRevenue)}</div><div class="stat-label">Gesamtumsatz aller Reservierungen</div></div>` : `<div class="stat-card"><div class="stat-value">${euro(session.salary)}</div><div class="stat-label">Mein Lohn</div></div>`}
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
  renderStats(list);

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

function animateNumber(el, endValue, isCurrency) {
  const duration = 700;
  const start = performance.now();
  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = endValue * eased;
    el.textContent = isCurrency ? euro(current) : Math.round(current);
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderStats(list) {
  const total = list.reduce((sum, r) => sum + (r.price || 0) * (r.quantity || 1), 0);
  const paid = list.filter((r) => r.status === 'bezahlt').reduce((sum, r) => sum + (r.price || 0) * (r.quantity || 1), 0);
  const open = list.filter((r) => r.status === 'offen').length;
  const cards = [
    { label: 'Gesamtumsatz', value: total, currency: true },
    { label: 'Bereits bezahlt', value: paid, currency: true },
    { label: 'Offene Reservierungen', value: open, currency: false },
  ];
  $('#stats-row').innerHTML = cards.map((c, i) => `
    <div class="stat-card">
      <div class="stat-value" id="stat-value-${i}">0</div>
      <div class="stat-label">${c.label}</div>
    </div>`).join('');
  cards.forEach((c, i) => animateNumber($(`#stat-value-${i}`), c.value, c.currency));
}

function exportCsv() {
  const headers = ['Reservierungsnummer', 'Produkt', 'Kunde', 'E-Mail', 'Telefon', 'Stück', 'Preis', 'Status', 'Erstellt von', 'Erstellt am'];
  const rows = reservations.map((r) => [
    r.reservation_number, r.product, r.customer_name, r.customer_email, r.customer_phone || '',
    r.quantity, r.price, STATUS_LABEL[r.status] || r.status, r.created_by || '', fmtDate(r.created_at),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reservierungen_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$('#export-csv-btn').addEventListener('click', exportCsv);

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
      <div><span class="muted">Stück / Preis</span><br>${r.quantity} × ${euro(r.price)} = ${euro(r.price * r.quantity)}</div>
      ${r.created_by ? `<div><span class="muted">Angelegt von</span><br>${escapeHtml(r.created_by)}</div>` : ''}
    </div>
    <label class="status-select-label">Status
      <select id="status-select">
        ${Object.entries(STATUS_LABEL).map(([val, label]) => `<option value="${val}" ${r.status === val ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </label>
    ${r.notes ? `<p class="notes-box">${escapeHtml(r.notes)}</p>` : ''}
    <button id="delete-res-btn" class="btn-danger">Reservierung löschen</button>
    <hr class="divider" />
    <h3>E-Mail-Verlauf</h3>
    <div id="email-thread" class="email-thread"><p class="muted">Lade…</p></div>
    <div class="template-row">
      ${emailTemplates.map((t) => `<button type="button" class="template-btn" data-template-id="${t.id}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
    <form id="compose-form" class="compose-form">
      <input type="text" id="compose-subject" placeholder="Betreff" required />
      <textarea id="compose-body" rows="4" placeholder="Nachricht…" required></textarea>
      <button type="submit" class="btn-primary" id="compose-send-btn">Senden</button>
      <p id="compose-error" class="error-text"></p>
    </form>
  `;

  $$('.template-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const t = emailTemplates.find((x) => x.id === btn.dataset.templateId);
      if (!t) return;

      if (t.is_chat_invite) {
        btn.disabled = true;
        btn.textContent = 'Chat wird erstellt…';
        try {
          const data = await api('chat-create', { method: 'POST', body: { reservationId: r.id } });
          const chatLink = `${window.location.origin}/chat.html?token=${data.token}`;
          $('#compose-subject').value = fillTemplate(t.subject, r, { chatLink });
          $('#compose-body').value = fillTemplate(t.body, r, { chatLink });
        } catch (err) {
          alert('Chat konnte nicht erstellt werden: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = t.label;
        }
        return;
      }

      $('#compose-subject').value = fillTemplate(t.subject, r);
      $('#compose-body').value = fillTemplate(t.body, r);
    });
  });

  $('#delete-res-btn').addEventListener('click', async () => {
    if (!confirm(`Reservierung ${r.reservation_number} wirklich löschen?`)) return;
    try {
      await api('reservations', { method: 'DELETE', body: { id } });
      $('#detail-overlay').classList.add('hidden');
      loadReservations();
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
  });

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

// ===== Live-Chats (Mitarbeiterseite) =====
let staffChatPollTimer = null;
let staffChatSkeletonBuilt = false;
let staffChatSkeletonOpenState = null;
let currentStaffChatId = null;
let staffChatPollSeq = 0; // verhindert, dass eine veraltete Antwort (z.B. vor einer Verifizierung) eine neuere überschreibt

async function loadLiveChats() {
  try {
    const data = await api('chats-list');
    const chats = data.chats || [];
    checkForNewJoins(chats);
    const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    const badge = $('#livechat-badge');
    badge.textContent = totalUnread;
    badge.classList.toggle('hidden', totalUnread === 0);

    $('#livechats-empty').classList.toggle('hidden', chats.length !== 0);
    $('#livechats-list').innerHTML = chats.map((c) => `
      <div class="chat-list-item" data-chat-id="${c.id}">
        <div class="chat-list-info">
          <span class="chat-list-name">${escapeHtml(c.reservation?.customer_name || '?')} · ${escapeHtml(c.reservation?.reservation_number || '')}</span>
          <span class="chat-list-preview">${c.lastMessage ? escapeHtml(c.lastMessage.body) : 'Noch keine Nachricht'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${c.unreadCount ? `<span class="badge">${c.unreadCount}</span>` : ''}
          <span class="chat-status-pill ${c.status}">${c.status === 'open' ? 'Offen' : 'Beendet'}</span>
        </div>
      </div>`).join('');

    $$('.chat-list-item').forEach((el) => {
      el.addEventListener('click', () => openStaffChat(el.dataset.chatId));
    });
  } catch (err) {
    console.error(err);
  }
}

async function openStaffChat(chatId) {
  currentStaffChatId = chatId;
  staffChatSkeletonBuilt = false;
  $('#staff-chat-content').innerHTML = `<p class="muted" style="padding:24px 32px;">Lade…</p>`;
  $('#staff-chat-overlay').classList.remove('hidden');
  await refreshStaffChat();
  clearInterval(staffChatPollTimer);
  staffChatPollTimer = setInterval(refreshStaffChat, 4000);
}

async function refreshStaffChat() {
  if (!currentStaffChatId) return;
  const requestedChatId = currentStaffChatId;
  const seq = ++staffChatPollSeq;
  try {
    const data = await api(`chat?chatId=${requestedChatId}`);
    // Veraltete oder inzwischen zu einem anderen Chat gehörende Antwort ignorieren,
    // sonst kann z.B. der "Verifiziert"-Status kurz nach dem Bestätigen wieder auf
    // "Nicht verifiziert" zurückspringen, wenn eine ältere Anfrage später ankommt.
    if (seq !== staffChatPollSeq || requestedChatId !== currentStaffChatId) return;
    renderStaffChat(data.chat, data.reservation, data.messages || []);
  } catch (err) {
    if (seq !== staffChatPollSeq || requestedChatId !== currentStaffChatId) return;
    $('#staff-chat-content').innerHTML = `<p class="error-text" style="padding:24px 32px;">Chat konnte nicht geladen werden.</p>`;
  }
}

// Baut das Chat-Fenster nur EINMAL auf (beim Öffnen oder wenn sich der Status ändert).
// Bei jedem weiteren Aktualisieren (alle 4s) wird NUR die Nachrichtenliste ersetzt,
// damit ein gerade getippter, noch nicht gesendeter Text im Feld nicht verloren geht.
function renderStaffChat(chat, reservation, messages) {
  const isOpen = chat.status === 'open';

  if (!staffChatSkeletonBuilt || staffChatSkeletonOpenState !== `${isOpen}-${chat.verified}`) {
    staffChatSkeletonBuilt = true;
    staffChatSkeletonOpenState = `${isOpen}-${chat.verified}`;

    $('#staff-chat-content').innerHTML = `
      <div class="staff-chat-header">
        <h2>${escapeHtml(reservation?.customer_name || 'Chat')}</h2>
        <p class="muted mono" style="margin:0;">${escapeHtml(reservation?.reservation_number || '')} · ${escapeHtml(reservation?.product || '')}</p>
        <span class="chat-status-pill ${chat.status}" style="margin-top:8px;display:inline-block;">${isOpen ? 'Offen' : 'Beendet'}</span>
        <span class="chat-status-pill ${chat.verified ? 'open' : 'closed'}" style="margin-top:8px;display:inline-block;">${chat.verified ? '✓ Verifiziert' : 'Nicht verifiziert'}</span>
        ${isOpen ? `<button id="staff-chat-end-btn" class="link-btn" style="margin-left:10px;">Chat beenden</button>` : ''}
      </div>
      ${isOpen ? `
        <div class="staff-chat-actions">
          ${!chat.verified ? `<button class="staff-action-btn staff-action-btn-primary" data-action="send_verification">Verifizierungscode senden</button>` : ''}
          <button class="staff-action-btn" data-request-type="address">Adresse anfordern</button>
          <button class="staff-action-btn" data-request-type="reservation_number">Reservierungsnummer anfordern</button>
          <button class="staff-action-btn" data-request-type="name">Name anfordern</button>
        </div>` : ''}
      <div class="staff-chat-messages" id="staff-chat-messages"></div>
      ${isOpen ? `
        <div class="staff-chat-input-row">
          <textarea id="staff-chat-input" rows="2" placeholder="Nachricht schreiben…"></textarea>
          <button id="staff-chat-send-btn" class="btn-primary" style="width:auto;">Senden</button>
        </div>` : ''}
    `;

    $$('.staff-action-btn[data-request-type]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api('chat', { method: 'POST', body: { chatId: currentStaffChatId, requestType: btn.dataset.requestType } });
          refreshStaffChat();
        } catch (err) {
          alert(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    $('[data-action="send_verification"]')?.addEventListener('click', () => {
      openVerificationCodePopup(currentStaffChatId, () => refreshStaffChat());
    });

    $('#staff-chat-send-btn')?.addEventListener('click', async () => {
      const input = $('#staff-chat-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await api('chat', { method: 'POST', body: { chatId: currentStaffChatId, body: text } });
        refreshStaffChat();
      } catch (err) {
        alert('Senden fehlgeschlagen: ' + err.message);
      }
    });

    $('#staff-chat-end-btn')?.addEventListener('click', async () => {
      if (!confirm('Chat wirklich beenden?')) return;
      try {
        await api('chat', { method: 'PATCH', body: { chatId: currentStaffChatId } });
        refreshStaffChat();
        loadLiveChats();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  const msgBox = $('#staff-chat-messages');
  if (msgBox) {
    const shouldScroll = msgBox.scrollTop + msgBox.clientHeight >= msgBox.scrollHeight - 40;
    msgBox.innerHTML = messages.length ? messages.map((m) => `
      <div class="email-item ${m.sender === 'staff' ? 'email-out' : 'email-in'}">
        <div class="email-meta"><strong>${escapeHtml(m.sender_name || (m.sender === 'staff' ? 'Team' : 'Kunde'))}</strong><span class="muted">${fmtDate(m.created_at)}</span></div>
        <div class="email-body">${escapeHtml(m.body)}</div>
      </div>`).join('') : `<p class="muted">Noch keine Nachrichten.</p>`;
    if (shouldScroll) msgBox.scrollTop = msgBox.scrollHeight;
  }
}

// Popup, in dem der Mitarbeiter einen Verifizierungscode festlegt. Der Code wird
// automatisch per E-Mail an den Kunden verschickt (nicht im Chat angezeigt), und der
// Chat bekommt automatisch die Mitarbeiter-Nachricht "Wir haben Ihnen den
// Verifizierungscode gesendet. Schauen Sie bitte in Ihre E-Mails ...".
function openVerificationCodePopup(chatId, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.zIndex = '200';
  overlay.innerHTML = `
    <div class="modal" style="width:360px;">
      <h2 style="font-size:17px;">Verifizierungscode senden</h2>
      <form id="verify-code-form">
        <label>Code, der dem Kunden per E-Mail zugeschickt wird
          <input type="text" id="verify-code-value" required autocomplete="off" />
        </label>
        <div class="modal-actions">
          <button type="button" id="verify-code-cancel" class="btn-secondary">Abbrechen</button>
          <button type="submit" class="btn-primary">Senden</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#verify-code-value');
  input.value = String(Math.floor(100000 + Math.random() * 900000));
  input.focus();
  input.select();

  overlay.querySelector('#verify-code-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#verify-code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    const submitBtn = overlay.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api('chat', { method: 'POST', body: { chatId, action: 'send_verification', code } });
      overlay.remove();
      if (onDone) onDone();
    } catch (err) {
      alert(err.message);
      submitBtn.disabled = false;
    }
  });
}

// ===== Benachrichtigung, wenn ein Kunde dem Live-Chat beitritt =====
let notifiedJoinedChatIds = null; // null = noch nicht initialisiert (verhindert Alt-Benachrichtigungen beim ersten Laden)
let liveChatGlobalPollTimer = null;

function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function playJoinChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (err) { /* Sound ist optional, still fehlschlagen */ }
}

function showJoinToast(chat) {
  const name = chat.reservation?.customer_name || 'Ein Kunde';
  const toast = document.createElement('div');
  toast.className = 'join-toast';
  toast.innerHTML = `
    <div class="join-toast-title">💬 ${escapeHtml(name)} ist dem Live-Chat beigetreten</div>
    <div class="join-toast-sub">${escapeHtml(chat.reservation?.reservation_number || '')} · Klicken zum Öffnen</div>`;
  toast.addEventListener('click', () => {
    toast.remove();
    $('.nav-item[data-view="livechats"]')?.click();
    openStaffChat(chat.id);
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 12000);
}

function notifyCustomerJoined(chat) {
  playJoinChime();
  showJoinToast(chat);
  $('.nav-item[data-view="livechats"]')?.classList.add('has-new-join');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const name = chat.reservation?.customer_name || 'Ein Kunde';
    const n = new Notification('Live-Chat: neuer Beitritt', {
      body: `${name} ist dem Live-Chat beigetreten.`,
      tag: `chat-join-${chat.id}`,
    });
    n.onclick = () => {
      window.focus();
      $('.nav-item[data-view="livechats"]')?.click();
      openStaffChat(chat.id);
    };
  }
}

function checkForNewJoins(chats) {
  const joined = chats.filter((c) => c.customer_joined_at);
  if (notifiedJoinedChatIds === null) {
    // Erster Durchlauf: nur merken, welche Chats bereits beigetreten sind, nicht benachrichtigen.
    notifiedJoinedChatIds = new Set(joined.map((c) => c.id));
    return;
  }
  joined.forEach((chat) => {
    if (!notifiedJoinedChatIds.has(chat.id)) {
      notifiedJoinedChatIds.add(chat.id);
      notifyCustomerJoined(chat);
    }
  });
}

function startLiveChatGlobalPolling() {
  clearInterval(liveChatGlobalPollTimer);
  liveChatGlobalPollTimer = setInterval(loadLiveChats, 6000);
}

$('#staff-chat-close').addEventListener('click', () => {
  $('#staff-chat-overlay').classList.add('hidden');
  clearInterval(staffChatPollTimer);
  currentStaffChatId = null;
  staffChatSkeletonBuilt = false;
  loadLiveChats();
});

// ===== E-Mail-Vorlagen =====
async function loadTemplates() {
  try {
    const data = await api('templates');
    emailTemplates = data.templates || [];
    if (session.role === 'owner') renderTemplates();
  } catch (err) {
    console.error(err);
  }
}

function renderTemplates() {
  const el = $('#templates-list');
  if (!el) return;
  if (!emailTemplates.length) {
    el.innerHTML = `<p class="empty-state">Noch keine Vorlagen angelegt.</p>`;
    return;
  }
  el.innerHTML = emailTemplates.map((t) => `
    <div class="inbox-item">
      <div class="email-meta">
        <strong>${escapeHtml(t.label)}</strong>
        <button class="link-btn" data-del-template="${t.id}">Löschen</button>
      </div>
      <div class="email-subject">${escapeHtml(t.subject)}</div>
      <div class="email-body">${escapeHtml(t.body)}</div>
    </div>`).join('');

  $$('[data-del-template]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Vorlage "${btn.closest('.inbox-item').querySelector('strong').textContent}" wirklich löschen?`)) return;
      try {
        await api('templates', { method: 'DELETE', body: { id: btn.dataset.delTemplate } });
        loadTemplates();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

$('#new-template-btn').addEventListener('click', () => $('#new-template-overlay').classList.remove('hidden'));
$('#new-template-cancel').addEventListener('click', () => $('#new-template-overlay').classList.add('hidden'));

$('#new-template-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('templates', {
      method: 'POST',
      body: { label: fd.get('label'), subject: fd.get('subject'), body: fd.get('body') },
    });
    e.target.reset();
    $('#new-template-overlay').classList.add('hidden');
    loadTemplates();
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
});

// ===== Boot-Sequenz =====
const BOOT_STEPS = [
  'Kernel wird geladen',
  'Sicherheitsmodule initialisieren',
  'Verbindung zur Datenbank aufbauen',
  'Mitarbeiter-Sitzung verifizieren',
  'Postfach synchronisieren',
  'Oberfläche kompilieren',
];
const RING_CIRCUMFERENCE = 415; // 2 * PI * 66

function startBootParticles() {
  const canvas = $('#boot-canvas');
  const ctx = canvas.getContext('2d');
  let width, height, particles, raf;

  function resize() {
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const COUNT = Math.min(70, Math.floor((width * height) / 14000));
  particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
  }));

  function tick() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach((p) => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
    });
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          ctx.strokeStyle = `rgba(124,92,252,${0.18 * (1 - dist / 130)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(244,91,181,0.6)';
      ctx.beginPath();
      ctx.arc(particles[i].x, particles[i].y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  }
  tick();
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}

function typewriteLine(el, text, speed, onDone) {
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  el.appendChild(cursor);
  const interval = setInterval(() => {
    if (i >= text.length) {
      clearInterval(interval);
      cursor.remove();
      if (onDone) onDone();
      return;
    }
    cursor.insertAdjacentText('beforebegin', text[i]);
    i++;
  }, speed);
}

function runBootSequence(onDone) {
  const screen = $('#boot-screen');
  const linesEl = $('#boot-lines');
  const bar = $('#boot-progress-bar');
  const ring = $('#boot-ring-progress');
  const percentEl = $('#boot-percent');
  const wipe = $('#boot-wipe');
  const stopParticles = startBootParticles();

  function setProgress(pct) {
    bar.style.width = `${pct}%`;
    ring.style.strokeDashoffset = `${RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * pct) / 100}`;
    percentEl.textContent = `${pct}%`;
  }

  function runStep(i) {
    if (i >= BOOT_STEPS.length) {
      setTimeout(() => {
        stopParticles();
        wipe.classList.add('boot-wipe-run');
        setTimeout(() => {
          screen.classList.add('boot-hide');
          setTimeout(() => { screen.style.display = 'none'; onDone(); }, 320);
        }, 380);
      }, 250);
      return;
    }
    const step = BOOT_STEPS[i];
    const line = document.createElement('div');
    line.className = 'boot-line';
    const label = document.createElement('span');
    line.appendChild(label);
    linesEl.appendChild(line);
    linesEl.scrollTop = linesEl.scrollHeight;

    typewriteLine(label, step + '…', 18, () => {
      const okSpan = document.createElement('span');
      okSpan.className = 'ok';
      okSpan.textContent = 'OK';
      line.appendChild(okSpan);
      setProgress(Math.round(((i + 1) / BOOT_STEPS.length) * 100));
      setTimeout(() => runStep(i + 1), 140);
    });
  }

  setProgress(0);
  setTimeout(() => runStep(0), 550); // Glitch-Intro erst kurz wirken lassen
}

// ===== Start =====
runBootSequence(() => {
  if (session) showApp(); else showLogin();
});
