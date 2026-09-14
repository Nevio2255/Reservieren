const { supabaseAdmin, getSession, json, checkMaintenance } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });
  const maintenanceBlock = await checkMaintenance(session);
  if (maintenanceBlock) return maintenanceBlock;

  const { data: emails, error } = await supabaseAdmin
    .from('emails')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return json(500, { error: 'Laden fehlgeschlagen.' });
  if (!emails || !emails.length) return json(200, { channels: [] });

  const reservationIds = [...new Set(emails.filter((e) => e.reservation_id).map((e) => e.reservation_id))];
  const { data: reservations } = reservationIds.length
    ? await supabaseAdmin.from('reservations').select('id, customer_name, reservation_number').in('id', reservationIds)
    : { data: [] };

  const groups = new Map();
  for (const mail of emails) {
    const key = mail.reservation_id || `unmatched:${mail.from_address}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mail);
  }

  const channels = [...groups.entries()].map(([key, mails]) => {
    const reservation = mails[0].reservation_id ? reservations.find((r) => r.id === mails[0].reservation_id) : null;
    const lastMessage = mails[0]; // schon absteigend sortiert
    const unreadCount = mails.filter((m) => m.direction === 'in' && !m.is_read).length;
    return {
      key,
      reservationId: mails[0].reservation_id || null,
      fromAddress: mails[0].reservation_id ? null : mails[0].from_address,
      customerName: reservation?.customer_name || null,
      reservationNumber: reservation?.reservation_number || null,
      lastMessage,
      unreadCount,
    };
  });

  channels.sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  return json(200, { channels });
};
