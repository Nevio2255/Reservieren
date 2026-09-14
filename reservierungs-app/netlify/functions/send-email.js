// Netlify Function: /.netlify/functions/send-email
// Sendet eine gestaltete HTML-E-Mail über das web.de-Postfach und speichert sie in Supabase.

const nodemailer = require('nodemailer');
const { supabaseAdmin, getSession, json } = require('./_lib');

const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Baut aus dem Klartext ein gestaltetes HTML mit LuxeFinds-Branding.
// URLs im Text werden automatisch zu einem Button (z. B. der Live-Chat-Link).
function buildEmailHtml(subject, plainBody) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = plainBody.match(urlRegex) || [];
  const textWithoutUrls = plainBody.replace(urlRegex, '').replace(/\n{3,}/g, '\n\n');
  const escapedText = escapeHtml(textWithoutUrls).trim().replace(/\n/g, '<br>');
  const logoUrl = SITE_URL ? `${SITE_URL}/assets/logo-wide.jpg` : '';

  const buttonsHtml = urls
    .map(
      (url) => `
      <tr><td style="padding-top:20px;">
        <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#7C5CFC,#F45BB5);color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:14px;padding:12px 26px;border-radius:8px;">Jetzt öffnen</a>
      </td></tr>`
    )
    .join('');

  return `
  <div style="background:#0B0D12;padding:32px 16px;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#141821;border-radius:14px;overflow:hidden;border:1px solid #262c3a;">
      <tr>
        <td style="padding:28px 32px 8px 32px;text-align:center;">
          ${logoUrl ? `<img src="${logoUrl}" alt="LuxeFinds" style="max-width:200px;height:auto;" />` : '<div style="font-size:22px;font-weight:bold;color:#ffffff;">LuxeFinds</div>'}
        </td>
      </tr>
      <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #262c3a;margin:16px 0;" /></td></tr>
      <tr>
        <td style="padding:0 32px 8px 32px;color:#F2F3F5;font-size:15px;line-height:1.6;">
          ${escapedText}
        </td>
      </tr>
      <table role="presentation" width="100%"><tr><td style="padding:0 32px;">${buttonsHtml}</td></tr></table>
      <tr>
        <td style="padding:28px 32px 24px 32px;color:#8A8F9C;font-size:12px;text-align:center;">
          LuxeFinds · Diese Nachricht wurde über unsere Verwaltung gesendet.
        </td>
      </tr>
    </table>
  </div>`;
}

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

  const transporter = nodemailer.createTransport({
    host: 'smtp.web.de',
    port: 587,
    secure: false, // STARTTLS auf Port 587
    auth: {
      user: process.env.WEBDE_EMAIL,
      pass: process.env.WEBDE_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from: `LuxeFinds <${process.env.WEBDE_EMAIL}>`,
      to,
      subject,
      text: body,
      html: buildEmailHtml(subject, body),
    });
  } catch (err) {
    console.error('SMTP-Fehler:', err);
    return json(502, { error: 'E-Mail konnte nicht gesendet werden.' });
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
