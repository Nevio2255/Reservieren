// Gemeinsames Mail-Modul: wird von send-email.js (manuelle E-Mails) und von
// chat.js (automatischer Verifizierungscode-Versand) verwendet.
const nodemailer = require('nodemailer');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Manche Mail-Server (z.B. bei Überlastung/Greylisting) antworten oft nur vorübergehend mit einem 4xx-Fehler
// (z. B. "450 mailbox unavailable, try again later"). Solche Kurzaussetzer lösen sich oft
// innerhalb weniger Sekunden von selbst, deshalb versuchen wir es hier automatisch noch
// 1x mit kurzer Pause, bevor wir aufgeben (Netlify-Functions haben nur ~10s Zeit insgesamt,
// daher keine langen Wartezeiten). Bei einem dauerhaften 5xx-Fehler (z. B. Adresse existiert
// nicht) wird sofort abgebrochen, da ein erneuter Versuch dort nichts bringt.
async function sendMailWithRetry(mailOptions, maxAttempts = 2) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // SSL auf Port 465
      auth: {
        user: process.env.GMAIL_EMAIL,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    try {
      await transporter.sendMail(mailOptions);
      return;
    } catch (err) {
      lastErr = err;
      const isPermanent = typeof err.responseCode === 'number' && err.responseCode >= 500;
      console.error(`SMTP-Fehler (Versuch ${attempt}/${maxAttempts}):`, err.message || err);
      if (isPermanent || attempt === maxAttempts) throw err;
      await sleep(2500);
    }
  }
  throw lastErr;
}

// Verschickt eine Mail über Gmail und gibt sie fertig fürs Speichern in der
// `emails`-Tabelle zurück (direction/from/to/subject/body).
async function sendBrandedEmail({ to, subject, body }) {
  await sendMailWithRetry({
    from: `LuxeFinds <${process.env.GMAIL_EMAIL}>`,
    to,
    subject,
    text: body,
    html: buildEmailHtml(subject, body),
  });
}

module.exports = { buildEmailHtml, sendMailWithRetry, sendBrandedEmail };
