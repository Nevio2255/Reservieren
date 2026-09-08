const { supabaseAdmin, getSession, json } = require('./_lib');

// Prüft, ob die aktuelle Anfrage vom Kunden (Token) oder einem Mitarbeiter (Bearer-Token) kommt,
// und ob der jeweilige Zugriff auf DIESEN Chat erlaubt ist. Gibt {chat, as} zurück oder null.
async function resolveAccess(event, params) {
  if (params.token) {
    const { data: chat } = await supabaseAdmin.from('live_chats').select('*').eq('token', params.token).maybeSingle();
    if (!chat) return null;
    return { chat, as: 'customer' };
  }

  const session = getSession(event);
  if (!session || !params.chatId) return null;
  const { data: chat } = await supabaseAdmin.from('live_chats').select('*').eq('id', params.chatId).maybeSingle();
  if (!chat) return null;
  if (session.role !== 'owner' && chat.employee_id !== session.id) return null;
  return { chat, as: 'staff', session };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};

  // ----- Nachrichten + Chat-Info abrufen -----
  if (event.httpMethod === 'GET') {
    const access = await resolveAccess(event, { token: q.token, chatId: q.chatId });
    if (!access) return json(404, { error: 'Chat nicht gefunden oder kein Zugriff.' });

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('product, reservation_number, customer_name')
      .eq('id', access.chat.reservation_id)
      .maybeSingle();

    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('chat_id', access.chat.id)
      .order('created_at', { ascending: true });

    if (access.as === 'staff') {
      const unreadIds = (messages || []).filter((m) => m.sender === 'customer' && !m.read_by_staff).map((m) => m.id);
      if (unreadIds.length) {
        await supabaseAdmin.from('chat_messages').update({ read_by_staff: true }).in('id', unreadIds);
      }
    }

    return json(200, { chat: access.chat, reservation, messages: messages || [] });
  }

  // ----- Nachricht senden -----
  if (event.httpMethod === 'POST') {
    const access = await resolveAccess(event, { token: body.token, chatId: body.chatId });
    if (!access) return json(404, { error: 'Chat nicht gefunden oder kein Zugriff.' });
    if (access.chat.status !== 'open') return json(409, { error: 'Dieser Chat wurde bereits beendet.' });
    if (!body.body || !body.body.trim()) return json(400, { error: 'Nachricht darf nicht leer sein.' });

    let senderName = 'Team';
    if (access.as === 'customer') {
      const { data: reservation } = await supabaseAdmin
        .from('reservations').select('customer_name').eq('id', access.chat.reservation_id).maybeSingle();
      senderName = reservation?.customer_name || 'Kunde';
    } else {
      senderName = access.session.name;
    }

    const { error } = await supabaseAdmin.from('chat_messages').insert({
      chat_id: access.chat.id,
      sender: access.as === 'customer' ? 'customer' : 'staff',
      sender_name: senderName,
      body: body.body.trim(),
      read_by_staff: access.as === 'staff',
    });
    if (error) return json(500, { error: 'Senden fehlgeschlagen.' });
    return json(200, { success: true });
  }

  // ----- Chat schließen -----
  if (event.httpMethod === 'PATCH') {
    const access = await resolveAccess(event, { token: body.token, chatId: body.chatId });
    if (!access) return json(404, { error: 'Chat nicht gefunden oder kein Zugriff.' });

    await supabaseAdmin.from('live_chats').update({
      status: 'closed',
      closed_by: access.as === 'customer' ? 'customer' : 'employee',
      closed_at: new Date().toISOString(),
    }).eq('id', access.chat.id);

    return json(200, { success: true });
  }

  return json(405, { error: 'Method Not Allowed' });
};
