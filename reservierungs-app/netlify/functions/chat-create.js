const crypto = require('crypto');
const { supabaseAdmin, getSession, json } = require('./_lib');

const euro = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

async function buildGreeting(reservation) {
  const { data: allReservations } = await supabaseAdmin
    .from('reservations')
    .select('product, price, quantity')
    .eq('customer_email', reservation.customer_email)
    .order('created_at', { ascending: true });

  const list = allReservations && allReservations.length ? allReservations : [reservation];

  if (list.length === 1) {
    const r = list[0];
    return `Guten Tag ${reservation.customer_name},\n\nSie haben bei uns folgende Reservierung:\n\n${r.product} – ${euro(r.price * r.quantity)}\nStatus: Reserviert`;
  }

  const lines = list.map((r, i) => `${i + 1}. ${r.product} – ${euro(r.price * r.quantity)}`).join('\n');
  return `Guten Tag ${reservation.customer_name},\n\nSie haben bei uns ${list.length} Reservierungen:\n\n${lines}\n\nStatus: Reserviert`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  const { reservationId } = JSON.parse(event.body || '{}');
  if (!reservationId) return json(400, { error: 'reservationId erforderlich.' });

  const { data: existing } = await supabaseAdmin
    .from('live_chats')
    .select('*')
    .eq('reservation_id', reservationId)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) {
    return json(200, { token: existing.token, chatId: existing.id, reused: true });
  }

  const { data: reservation } = await supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('id', reservationId)
    .maybeSingle();
  if (!reservation) return json(404, { error: 'Reservierung nicht gefunden.' });

  const token = crypto.randomBytes(20).toString('hex');
  const { data: created, error } = await supabaseAdmin
    .from('live_chats')
    .insert({ reservation_id: reservationId, employee_id: session.id, token })
    .select()
    .single();

  if (error) {
    console.error('Chat-Erstellen-Fehler:', error);
    return json(500, { error: 'Chat konnte nicht erstellt werden: ' + error.message });
  }

  const greeting = await buildGreeting(reservation);
  await supabaseAdmin.from('chat_messages').insert({
    chat_id: created.id,
    sender: 'staff',
    sender_name: 'LuxeFinds',
    body: greeting,
    read_by_staff: true,
  });

  return json(200, { token: created.token, chatId: created.id, reused: false });
};
