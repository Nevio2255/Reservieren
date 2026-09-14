const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  // Nur Mails von Kunden (= mit einer Reservierung verknüpft) zeigen; alles
  // andere (Newsletter, nicht zuordenbare Absender usw.) wird ausgeblendet.
  const { data: emails, error } = await supabaseAdmin
    .from('emails')
    .select('*')
    .not('reservation_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) return json(500, { error: 'Laden fehlgeschlagen.' });
  if (!emails || !emails.length) return json(200, { channels: [] });

  const reservationIds = [...new Set(emails.map((e) => e.reservation_id))];
  const { data: reservations } = reservationIds.length
    ? await supabaseAdmin.from('reservations').select('id, customer_name, reservation_number').in('id', reservationIds)
    : { data: [] };

  const groups = new Map();
  for (const mail of emails) {
    const key = mail.reservation_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mail);
  }

  const channels = [...groups.entries()].map(([key, mails]) => {
    const reservation = reservations.find((r) => r.id === mails[0].reservation_id);
    const lastMessage = mails[0]; // schon absteigend sortiert
    const unreadCount = mails.filter((m) => m.direction === 'in' && !m.is_read).length;
    return {
      key,
      reservationId: mails[0].reservation_id,
      fromAddress: null,
      customerName: reservation?.customer_name || null,
      reservationNumber: reservation?.reservation_number || null,
      lastMessage,
      unreadCount,
    };
  });

  channels.sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  return json(200, { channels });
};
