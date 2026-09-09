const { supabaseAdmin, getSession, json } = require('./_lib');

const REQUEST_PROMPTS = {
  address: 'Können Sie uns bitte Ihre Adresse mitteilen?',
  reservation_number: 'Können Sie uns bitte Ihre Reservierungsnummer mitteilen?',
  name: 'Wie ist Ihr vollständiger Name?',
};

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

    // --- Beitritt des Kunden vermerken (nur beim allerersten Aufruf) ---
    if (access.as === 'customer' && !access.chat.customer_joined_at) {
      const joinedAt = new Date().toISOString();
      await supabaseAdmin.from('live_chats').update({ customer_joined_at: joinedAt }).eq('id', access.chat.id);
      access.chat.customer_joined_at = joinedAt;
    }

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('product, reservation_number, customer_name, customer_email')
      .eq('id', access.chat.reservation_id)
      .maybeSingle();

    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('chat_id', access.chat.id)
      .order('created_at', { ascending: true });

    if (access.as === 'staff') {
      const unreadIds = (messages || []).filter((m) => m.sender === 'customer' && !m.read_by_staff).map((m) => m.id);
      if (unreadIds.length) await supabaseAdmin.from('chat_messages').update({ read_by_staff: true }).in('id', unreadIds);
    }

    return json(200, { chat: access.chat, reservation, messages: messages || [] });
  }

  // ----- Aktionen: Nachricht senden / Schnellaktion / Verifizierung -----
  if (event.httpMethod === 'POST') {
    const access = await resolveAccess(event, { token: body.token, chatId: body.chatId });
    if (!access) return json(404, { error: 'Chat nicht gefunden oder kein Zugriff.' });
    if (access.chat.status !== 'open') return json(409, { error: 'Dieser Chat wurde bereits beendet.' });

    // --- Mitarbeiter: Verifizierungscode setzen (wird vom Mitarbeiter selbst an den Kunden geschickt) ---
    if (body.action === 'send_verification') {
      if (access.as !== 'staff') return json(403, { error: 'Nur Mitarbeiter dürfen das.' });
      const code = (body.code || '').trim();
      if (!code) return json(400, { error: 'Bitte einen Code eingeben.' });

      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await supabaseAdmin.from('live_chats').update({ verification_code: code, verification_expires_at: expires }).eq('id', access.chat.id);

      await supabaseAdmin.from('chat_messages').insert({
        chat_id: access.chat.id, sender: 'staff', sender_name: access.session.name,
        body: 'Wir haben Ihnen einen Verifizierungscode geschickt. Bitte geben Sie ihn hier im Chat ein, um fortzufahren.',
        request_type: 'verification', read_by_staff: true,
      });
      return json(200, { success: true });
    }

    // --- Kunde: Verifizierungscode einreichen ---
    if (body.action === 'submit_verification') {
      if (access.as !== 'customer') return json(403, { error: 'Nur der Kunde darf das.' });
      if (!body.code) return json(400, { error: 'Code erforderlich.' });
      if (access.chat.verified) return json(200, { success: true, alreadyVerified: true });
      if (!access.chat.verification_code || access.chat.verification_code !== body.code.trim()) {
        return json(401, { error: 'Code ist falsch.' });
      }
      if (new Date(access.chat.verification_expires_at) < new Date()) {
        return json(401, { error: 'Code ist abgelaufen. Bitte den Mitarbeiter um einen neuen Code bitten.' });
      }
      await supabaseAdmin.from('live_chats').update({ verified: true }).eq('id', access.chat.id);
      await supabaseAdmin.from('chat_messages').insert({
        chat_id: access.chat.id, sender: 'staff', sender_name: 'LuxeFinds',
        body: '✅ Chat wurde freigeschaltet. Sie können jetzt schreiben.', read_by_staff: true,
      });
      return json(200, { success: true });
    }

    // --- Mitarbeiter: Schnellaktion (Adresse/Reservierungsnummer/Name anfordern) ---
    if (body.requestType) {
      if (access.as !== 'staff') return json(403, { error: 'Nur Mitarbeiter dürfen das.' });
      const prompt = REQUEST_PROMPTS[body.requestType];
      if (!prompt) return json(400, { error: 'Unbekannte Anfrage.' });
      await supabaseAdmin.from('chat_messages').insert({
        chat_id: access.chat.id, sender: 'staff', sender_name: access.session.name,
        body: prompt, request_type: body.requestType, read_by_staff: true,
      });
      return json(200, { success: true });
    }

    // --- Normale Nachricht senden ---
    if (!body.body || !body.body.trim()) return json(400, { error: 'Nachricht darf nicht leer sein.' });
    if (access.as === 'customer' && !access.chat.verified) {
      return json(403, { error: 'Bitte zuerst den Verifizierungscode eingeben.' });
    }

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
