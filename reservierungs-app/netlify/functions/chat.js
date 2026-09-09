const nodemailer = require('nodemailer');
const { supabaseAdmin, getSession, json } = require('./_lib');

const REQUEST_PROMPTS = {
  address: 'Können Sie uns bitte Ihre Adresse mitteilen?',
  reservation_number: 'Können Sie uns bitte Ihre Reservierungsnummer mitteilen?',
  name: 'Wie ist Ihr vollständiger Name?',
};

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail(toAddress, code) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.web.de',
    port: 587,
    secure: false,
    auth: { user: process.env.WEBDE_EMAIL, pass: process.env.WEBDE_APP_PASSWORD },
  });
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const logoUrl = siteUrl ? `${siteUrl}/assets/logo-wide.jpg` : '';
  const html = `
  <div style="background:#0B0D12;padding:32px 16px;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#141821;border-radius:14px;overflow:hidden;border:1px solid #262c3a;">
      <tr><td style="padding:28px 32px 8px 32px;text-align:center;">
        ${logoUrl ? `<img src="${logoUrl}" alt="LuxeFinds" style="max-width:180px;" />` : '<div style="font-size:20px;font-weight:bold;color:#fff;">LuxeFinds</div>'}
      </td></tr>
      <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #262c3a;margin:16px 0;" /></td></tr>
      <tr><td style="padding:0 32px 8px 32px;color:#F2F3F5;font-size:15px;line-height:1.6;text-align:center;">
        Dein Verifizierungscode für den Live-Chat:
        <div style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#F45BB5;margin:18px 0;">${code}</div>
        Gib diesen Code im Chat-Fenster ein, um fortzufahren.
      </td></tr>
      <tr><td style="padding:28px 32px 24px 32px;color:#8A8F9C;font-size:12px;text-align:center;">LuxeFinds</td></tr>
    </table>
  </div>`;
  await transporter.sendMail({
    from: `LuxeFinds <${process.env.WEBDE_EMAIL}>`,
    to: toAddress,
    subject: 'Dein Verifizierungscode für den Live-Chat',
    text: `Dein Verifizierungscode: ${code}`,
    html,
  });
}

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

    // --- Mitarbeiter: Verifizierungscode an den Kunden senden ---
    if (body.action === 'send_verification') {
      if (access.as !== 'staff') return json(403, { error: 'Nur Mitarbeiter dürfen das.' });
      const { data: reservation } = await supabaseAdmin
        .from('reservations').select('customer_email').eq('id', access.chat.reservation_id).maybeSingle();
      if (!reservation) return json(404, { error: 'Reservierung nicht gefunden.' });

      const code = randomCode();
      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const { error: updateError } = await supabaseAdmin
        .from('live_chats')
        .update({ verification_code: code, verification_expires_at: expires })
        .eq('id', access.chat.id);

      if (updateError) {
        console.error('Verifizierungscode-Speichern-Fehler:', updateError);
        return json(500, { error: 'Code konnte nicht gespeichert werden: ' + updateError.message });
      }

      try {
        await sendVerificationEmail(reservation.customer_email, code);
      } catch (err) {
        console.error('Verifizierungs-Mail-Fehler:', err);
        return json(502, { error: 'Verifizierungs-Mail konnte nicht gesendet werden.' });
      }

      await supabaseAdmin.from('chat_messages').insert({
        chat_id: access.chat.id, sender: 'staff', sender_name: access.session.name,
        body: 'Wir haben Ihnen einen Verifizierungscode per E-Mail geschickt. Bitte geben Sie ihn hier im Chat ein, um fortzufahren.',
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
