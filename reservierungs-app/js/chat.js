const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let lastMessageCount = 0;
let pollTimer = null;
let isClosed = false;
let isVerified = false;
let pollSeq = 0; // verhindert, dass eine veraltete (spät ankommende) Antwort eine neuere überschreibt

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

async function api(method, body) {
  const url = method === 'GET' ? `/.netlify/functions/chat?token=${encodeURIComponent(token)}` : '/.netlify/functions/chat';
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ token, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

const REQUEST_LABELS = {
  address: { label: 'Adresse angeben', fields: [{ key: 'street', label: 'Straße & Hausnummer' }, { key: 'zip', label: 'PLZ' }, { key: 'city', label: 'Ort' }] },
  reservation_number: { label: 'Reservierungsnummer angeben', fields: [{ key: 'value', label: 'Reservierungsnummer' }] },
  name: { label: 'Namen angeben', fields: [{ key: 'value', label: 'Vollständiger Name' }] },
};

function parseVerificationCode(body) {
  const withLabel = String(body).match(/:\s*([A-Za-z0-9]{3,10})\s*$/);
  if (withLabel) return withLabel[1];
  const trimmed = String(body).trim();
  if (/^[A-Za-z0-9]{3,10}$/.test(trimmed)) return trimmed; // Rückwärtskompatibel für alte Nachrichten
  return null;
}

// Erkennt die automatische Begrüßungs-/Reservierungsnachricht und zerlegt sie in
// ihre Bestandteile, damit sie nicht als ein großer Textblock, sondern strukturiert
// (Name, Positionen, Status-Badge) dargestellt werden kann.
function parseGreeting(body) {
  const text = String(body);
  const single = text.match(/^Guten Tag ([^,]+),\n\nSie haben bei uns folgende Reservierung:\n\n([\s\S]+?) – ([^\n]+)\nStatus: (.+)$/);
  if (single) {
    return { name: single[1], items: [{ product: single[2], price: single[3] }], status: single[4] };
  }
  const multi = text.match(/^Guten Tag ([^,]+),\n\nSie haben bei uns \d+ Reservierungen:\n\n([\s\S]+?)\n\nStatus: (.+)$/);
  if (multi) {
    const items = multi[2].split('\n').filter(Boolean).map((line) => {
      const lm = line.match(/^\d+\.\s*(.+?) – (.+)$/);
      return lm ? { product: lm[1], price: lm[2] } : { product: line, price: '' };
    });
    return { name: multi[1], items, status: multi[3] };
  }
  return null;
}

function isSuccessMessage(body) { return String(body).trim().startsWith('✅'); }

async function copyCode(card, code) {
  const hint = card.querySelector('.chat-code-hint');
  try {
    await navigator.clipboard.writeText(code);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* ignorieren */ }
    document.body.removeChild(ta);
  }
  if (hint) {
    const original = hint.textContent;
    hint.textContent = '✓ Kopiert!';
    card.classList.add('copied');
    setTimeout(() => { hint.textContent = original; card.classList.remove('copied'); }, 1600);
  }
}

function renderMessages(chat, reservation, messages) {
  const wrap = $('#chat-messages');
  isVerified = !!chat.verified;

  if (!messages.length) {
    wrap.innerHTML = `<div class="chat-empty">Schreib uns gerne, wir antworten so schnell wie möglich!</div>`;
  } else {
    const shouldScroll = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 40;
    wrap.innerHTML = messages.map((m) => {
      const time = fmtTime(m.created_at);
      if (m.request_type === 'verification' && m.sender === 'staff') {
        const code = parseVerificationCode(m.body);
        if (code) {
          return `
          <div class="chat-code-card" data-code="${escapeHtml(code)}">
            <div class="chat-code-label">🔑 Dein Verifizierungscode</div>
            <div class="chat-code-value">${escapeHtml(code)}</div>
            <div class="chat-code-hint">Tippen zum Kopieren</div>
            <div class="chat-bubble-meta">${time}</div>
          </div>`;
        }
      }
      if (m.sender === 'staff') {
        const greeting = parseGreeting(m.body);
        if (greeting) {
          return `
          <div class="chat-bubble staff bubble-greeting">
            <div class="greeting-hello">Guten Tag ${escapeHtml(greeting.name)},</div>
            <div class="greeting-sub">${greeting.items.length > 1 ? `Sie haben bei uns ${greeting.items.length} Reservierungen:` : 'Sie haben bei uns folgende Reservierung:'}</div>
            <div class="greeting-items">
              ${greeting.items.map((it) => `
                <div class="greeting-item">
                  <span class="greeting-product">${escapeHtml(it.product)}</span>
                  <span class="greeting-price">${escapeHtml(it.price)}</span>
                </div>`).join('')}
            </div>
            <div class="greeting-status"><span class="status-dot"></span>${escapeHtml(greeting.status)}</div>
            <span class="chat-bubble-time">${time}</span>
          </div>`;
        }
        if (isSuccessMessage(m.body)) {
          return `
          <div class="chat-bubble staff bubble-success">
            <span class="success-icon">✓</span>
            <span class="success-body">${escapeHtml(String(m.body).replace(/^✅\s*/, ''))}<span class="chat-bubble-time">${time}</span></span>
          </div>`;
        }
      }
      const reqInfo = m.request_type && REQUEST_LABELS[m.request_type];
      const canAnswer = reqInfo && isVerified && !isClosed && m.sender === 'staff';
      return `
      <div class="chat-bubble ${m.sender === 'customer' ? 'customer' : 'staff'}">
        ${escapeHtml(m.body)}<span class="chat-bubble-time">${time}</span>
        ${canAnswer ? `<button class="chat-answer-btn" data-request-type="${m.request_type}">${escapeHtml(reqInfo.label)}</button>` : ''}
      </div>`;
    }).join('');
    if (shouldScroll || messages.length !== lastMessageCount) wrap.scrollTop = wrap.scrollHeight;

    $$('.chat-answer-btn').forEach((btn) => btn.addEventListener('click', () => openRequestPopup(btn.dataset.requestType)));
    $$('.chat-code-card').forEach((card) => card.addEventListener('click', () => copyCode(card, card.dataset.code)));
  }
  lastMessageCount = messages.length;

  $('#chat-header-sub').textContent = reservation ? `${reservation.product} · ${reservation.reservation_number}` : '';

  isClosed = chat.status !== 'open';
  $('#chat-status-dot').classList.toggle('closed', isClosed);
  $('#chat-closed-banner').classList.toggle('hidden', !isClosed);

  $('#chat-verify-bar').classList.toggle('hidden', isClosed || isVerified);
  $('#chat-input-bar').classList.toggle('hidden', isClosed || !isVerified);
  $('#chat-end-btn').classList.toggle('hidden', isClosed);
}

function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

async function poll() {
  const seq = ++pollSeq;
  try {
    const data = await api('GET');
    if (seq !== pollSeq) return; // eine neuere Anfrage läuft/ist bereits fertig – diese Antwort ist veraltet
    renderMessages(data.chat, data.reservation, data.messages || []);
  } catch (err) { /* beim Polling stille Fehler ignorieren */ }
}

async function init() {
  if (!token) {
    $('#chat-loading').classList.add('hidden');
    $('#chat-error').classList.remove('hidden');
    return;
  }
  try {
    const data = await api('GET');
    renderMessages(data.chat, data.reservation, data.messages || []);
    $('#chat-loading').classList.add('hidden');
    $('#chat-page').classList.remove('hidden');
    pollTimer = setInterval(poll, 4000);
  } catch (err) {
    $('#chat-loading').classList.add('hidden');
    const errEl = $('#chat-error');
    // Den echten Fehler mit anzeigen statt nur der pauschalen "ungültig"-Meldung,
    // damit man sofort sieht, woran es wirklich liegt.
    errEl.textContent = 'Dieser Chat-Link ist ungültig oder wurde nicht gefunden. (' + (err.message || 'unbekannter Fehler') + ')';
    errEl.classList.remove('hidden');
  }
}

// ----- Nachricht senden -----
const textarea = document.getElementById('chat-input');
textarea?.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
});
textarea?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const text = textarea.value.trim();
  if (!text || isClosed) return;
  const btn = $('#chat-send-btn');
  btn.disabled = true;
  textarea.value = '';
  textarea.style.height = 'auto';
  try {
    await api('POST', { body: text });
    await poll();
  } catch (err) {
    alert('Nachricht konnte nicht gesendet werden.');
  } finally {
    btn.disabled = false;
  }
}
document.getElementById('chat-send-btn')?.addEventListener('click', sendMessage);

document.getElementById('chat-end-btn')?.addEventListener('click', async () => {
  if (!confirm('Chat wirklich beenden?')) return;
  try {
    await api('PATCH');
    clearInterval(pollTimer);
    await poll();
  } catch (err) {
    alert('Konnte den Chat nicht beenden.');
  }
});

// ----- Verifizierung -----
document.getElementById('verify-submit-btn')?.addEventListener('click', async () => {
  const input = $('#verify-code-input');
  const submitBtn = $('#verify-submit-btn');
  const errorEl = $('#verify-error');
  errorEl.textContent = '';
  const code = input.value.trim();
  if (!code) return;
  submitBtn.disabled = true;
  try {
    await api('POST', { action: 'submit_verification', code });
    input.value = '';
    // Sofort freischalten, statt auf den nächsten Poll zu warten – so bleibt
    // die Ansicht auch dann korrekt, wenn kurz zuvor noch eine ältere
    // Polling-Antwort unterwegs war.
    isVerified = true;
    $('#chat-verify-bar').classList.add('hidden');
    $('#chat-input-bar').classList.remove('hidden');
    await poll();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ----- Popup für Schnellaktions-Antworten -----
function openRequestPopup(requestType) {
  const info = REQUEST_LABELS[requestType];
  if (!info) return;
  const overlay = document.createElement('div');
  overlay.className = 'chat-popup-overlay';
  overlay.innerHTML = `
    <div class="chat-popup">
      <h3>${escapeHtml(info.label)}</h3>
      <form id="chat-popup-form">
        ${info.fields.map((f) => `<label>${escapeHtml(f.label)}<input type="text" name="${f.key}" required /></label>`).join('')}
        <div class="chat-popup-actions">
          <button type="button" id="chat-popup-cancel" class="btn-secondary">Abbrechen</button>
          <button type="submit" class="btn-primary">Absenden</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#chat-popup-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#chat-popup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let text;
    if (requestType === 'address') {
      text = `Adresse: ${fd.get('street')}, ${fd.get('zip')} ${fd.get('city')}`;
    } else if (requestType === 'reservation_number') {
      text = `Reservierungsnummer: ${fd.get('value')}`;
    } else {
      text = `Name: ${fd.get('value')}`;
    }
    try {
      await api('POST', { body: text });
      overlay.remove();
      await poll();
    } catch (err) {
      alert('Senden fehlgeschlagen: ' + err.message);
    }
  });
}

init();
