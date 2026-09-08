const crypto = require('crypto');
const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  const { reservationId } = JSON.parse(event.body || '{}');
  if (!reservationId) return json(400, { error: 'reservationId erforderlich.' });

  // Falls für diese Reservierung schon ein offener Chat existiert: den wiederverwenden
  const { data: existing } = await supabaseAdmin
    .from('live_chats')
    .select('*')
    .eq('reservation_id', reservationId)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) {
    return json(200, { token: existing.token, chatId: existing.id, reused: true });
  }

  const token = crypto.randomBytes(20).toString('hex');
  const { data: created, error } = await supabaseAdmin
    .from('live_chats')
    .insert({ reservation_id: reservationId, employee_id: session.id, token })
    .select()
    .single();

  if (error) return json(500, { error: 'Chat konnte nicht erstellt werden.' });
  return json(200, { token: created.token, chatId: created.id, reused: false });
};
