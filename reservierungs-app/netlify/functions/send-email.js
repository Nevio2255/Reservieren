// Netlify Function: /.netlify/functions/send-email
// Sendet eine gestaltete HTML-E-Mail über das web.de-Postfach und speichert sie in Supabase.

const { supabaseAdmin, getSession, json } = require('./_lib');
const { buildEmailHtml, sendMailWithRetry } = require('./_mailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Ungültige Anfrage.' });
  }

  const { to, subject, body, reservationId } = payload;
  if (!to || !subject || !body) {
    return json(400, { error: 'to, subject und body sind erforderlich.' });
  }

  try {
    await sendMailWithRetry({
      from: `LuxeFinds <${process.env.WEBDE_EMAIL}>`,
      to,
      subject,
      text: body,
      html: buildEmailHtml(subject, body),
    });
  } catch (err) {
    console.error('SMTP-Fehler (endgültig):', err);
    return json(502, { error: 'E-Mail konnte nicht gesendet werden (Postfach vorübergehend nicht erreichbar). Bitte in ein paar Minuten erneut versuchen.' });
  }

  const { error: dbError } = await supabaseAdmin.from('emails').insert({
    reservation_id: reservationId || null,
    direction: 'out',
    from_address: process.env.WEBDE_EMAIL,
    to_address: to,
    subject,
    body,
    is_read: true,
  });

  if (dbError) {
    console.error('Supabase-Fehler:', dbError);
    return json(207, { warning: 'E-Mail wurde gesendet, aber nicht gespeichert.' });
  }

  return json(200, { success: true });
};
