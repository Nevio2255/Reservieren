// Netlify Function: /.netlify/functions/send-email
// Sendet eine gestaltete HTML-E-Mail über das web.de-Postfach und speichert sie in Supabase.

const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { supabaseAdmin, getSession, json } = require('./_lib');

const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const euro = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Baut eine einfache, saubere Rechnungs-PDF für eine Reservierung.
function buildInvoicePdf(reservation) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#141821').text('LuxeFinds', { continued: false });
    doc.fontSize(10).fillColor('#8A8F9C').text('Rechnung / Quittung').moveDown(1.5);

    doc.fontSize(11).fillColor('#141821');
    doc.text(`Reservierungsnummer: ${reservation.reservation_number}`);
    doc.text(`Datum: ${new Date(reservation.created_at).toLocaleDateString('de-DE')}`);
    doc.text(`Kunde: ${reservation.customer_name}`);
    doc.text(`E-Mail: ${reservation.customer_email}`);
    if (reservation.customer_phone) doc.text(`Telefon: ${reservation.customer_phone}`);
    doc.moveDown(1.5);

    const total = reservation.price * reservation.quantity;
    const tableTop = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Produkt', 50, tableTop);
    doc.text('Menge', 300, tableTop);
    doc.text('Einzelpreis', 370, tableTop);
    doc.text('Gesamt', 470, tableTop);
    doc.moveTo(50, tableTop + 16).lineTo(545, tableTop + 16).strokeColor('#DDDDDD').stroke();

    doc.font('Helvetica').text(reservation.product, 50, tableTop + 24);
    doc.text(String(reservation.quantity), 300, tableTop + 24);
    doc.text(euro(reservation.price), 370, tableTop + 24);
    doc.text(euro(total), 470, tableTop + 24);

    doc.moveTo(50, tableTop + 50).lineTo(545, tableTop + 50).strokeColor('#DDDDDD').stroke();
    doc.font('Helvetica-Bold').fontSize(13).text(`Gesamtbetrag: ${euro(total)}`, 50, tableTop + 62);

    doc.moveDown(4);
    doc.fontSize(9).fillColor('#8A8F9C').font('Helvetica').text('LuxeFinds · Vielen Dank für deine Reservierung.');

    doc.end();
  });
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

  const { to, subject, body, reservationId, attachInvoice } = payload;
  if (!to || !subject || !body) {
    return json(400, { error: 'to, subject und body sind erforderlich.' });
  }

  const attachments = [];
  if (attachInvoice && reservationId) {
    const { data: reservation } = await supabaseAdmin.from('reservations').select('*').eq('id', reservationId).maybeSingle();
    if (reservation) {
      try {
        const pdfBuffer = await buildInvoicePdf(reservation);
        attachments.push({ filename: `Rechnung-${reservation.reservation_number}.pdf`, content: pdfBuffer });
      } catch (err) {
        console.error('PDF-Erstellen-Fehler:', err);
      }
    }
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
      attachments,
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
