const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let lastMessageCount = 0;
let pollTimer = null;
let isClosed = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

async function api(method, body) {
  const url = method === 'GET' ? `/.netlify/functions/chat?token=${encodeURIComponent(token)}` : '/.netlify/functions/chat';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ token, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

function renderMessages(chat, reservation, messages) {
  const wrap = $('#chat-messages');
  if (!messages.length) {
    wrap.innerHTML = `<div class="chat-empty">Schreib uns gerne, wir antworten so schnell wie möglich!</div>`;
  } else {
    const shouldScroll = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 40;
    wrap.innerHTML = messages.map((m) => `
      <div class="chat-bubble ${m.sender === 'customer' ? 'customer' : 'staff'}">
        ${escapeHtml(m.body)}
        <div class="chat-bubble-meta">${m.sender === 'customer' ? 'Du' : escapeHtml(m.sender_name || 'Team')} · ${fmtTime(m.created_at)}</div>
      </div>`).join('');
    if (shouldScroll || messages.length !== lastMessageCount) wrap.scrollTop = wrap.scrollHeight;
  }
  lastMessageCount = messages.length;

  $('#chat-header-sub').textContent = reservation ? `${reservation.product} · ${reservation.reservation_number}` : '';

  isClosed = chat.status !== 'open';
  $('#chat-status-dot').classList.toggle('closed', isClosed);
  $('#chat-closed-banner').classList.toggle('hidden', !isClosed);
  $('#chat-input-bar').classList.toggle('hidden', isClosed);
  $('#chat-end-btn').classList.toggle('hidden', isClosed);
}

async function poll() {
  try {
    const data = await api('GET');
    renderMessages(data.chat, data.reservation, data.messages || []);
  } catch (err) {
    // Netzwerkfehler beim Polling einfach ignorieren und beim nächsten Versuch erneut probieren
  }
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
    $('#chat-error').classList.remove('hidden');
  }
}

const textarea = document.getElementById('chat-input');
textarea?.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
});
textarea?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
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

init();
