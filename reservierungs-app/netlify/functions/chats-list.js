const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  let query = supabaseAdmin.from('live_chats').select('*').order('created_at', { ascending: false });
  if (session.role !== 'owner') query = query.eq('employee_id', session.id);

  const { data: chats, error } = await query;
  if (error) return json(500, { error: 'Laden fehlgeschlagen.' });
  if (!chats || !chats.length) return json(200, { chats: [] });

  const reservationIds = [...new Set(chats.map((c) => c.reservation_id))];
  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('id, product, reservation_number, customer_name')
    .in('id', reservationIds);

  const chatIds = chats.map((c) => c.id);
  const { data: messages } = await supabaseAdmin
    .from('chat_messages')
    .select('chat_id, body, sender, created_at, read_by_staff')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false });

  const result = chats.map((chat) => {
    const reservation = reservations.find((r) => r.id === chat.reservation_id);
    const chatMessages = (messages || []).filter((m) => m.chat_id === chat.id);
    const lastMessage = chatMessages[0] || null;
    const unreadCount = chatMessages.filter((m) => m.sender === 'customer' && !m.read_by_staff).length;
    return { ...chat, reservation, lastMessage, unreadCount };
  });

  return json(200, { chats: result });
};
