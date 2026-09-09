// Netlify Scheduled Function: fetch-emails
// Läuft automatisch alle 10 Minuten (siehe netlify.toml), holt neue Mails aus dem
// Gmail-Postfach per IMAP, ordnet sie einer Reservierung zu (per Absender-Adresse)
// und speichert sie in Supabase.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { supabaseAdmin: supabase } = require('./_lib');

exports.handler = async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_EMAIL,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
    logger: false,
  });

  let processed = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // letzte bereits verarbeitete UID aus Supabase holen
      const { data: syncState } = await supabase
        .from('mail_sync_state')
        .select('last_uid')
        .eq('id', 1)
        .single();

      const lastUid = syncState?.last_uid || 0;

      // alle Nachrichten mit einer höheren UID als zuletzt verarbeitet
      const range = `${lastUid + 1}:*`;
      let maxUid = lastUid;

      for await (const message of client.fetch(range, { source: true, uid: true }, { uid: true })) {
        if (message.uid <= lastUid) continue; // Sicherheitsnetz gegen Duplikate

        const parsed = await simpleParser(message.source);
        const fromAddress = parsed.from?.value?.[0]?.address || 'unbekannt';
        const subject = parsed.subject || '(kein Betreff)';
        const body = parsed.text || parsed.html || '';

        // passende Reservierung anhand der Absender-Email suchen
        const { data: matchedReservation } = await supabase
          .from('reservations')
          .select('id')
          .ilike('customer_email', fromAddress)
          .limit(1)
          .maybeSingle();

        await supabase.from('emails').insert({
          reservation_id: matchedReservation?.id || null,
          direction: 'in',
          from_address: fromAddress,
          to_address: process.env.GMAIL_EMAIL,
          subject,
          body,
          is_read: false,
        });

        processed++;
        if (message.uid > maxUid) maxUid = message.uid;
      }

      if (maxUid > lastUid) {
        await supabase.from('mail_sync_state').update({ last_uid: maxUid }).eq('id', 1);
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error('IMAP-Fehler:', err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }

  return { statusCode: 200, body: JSON.stringify({ processed }) };
};
