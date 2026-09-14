const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  if (event.httpMethod === 'GET') {
    const reservationId = event.queryStringParameters?.reservation_id;
    const fromAddress = event.queryStringParameters?.from_address;

    let query = supabaseAdmin.from('emails').select('*').order('created_at', { ascending: true });
    if (reservationId) {
      query = query.eq('reservation_id', reservationId);
    } else if (fromAddress) {
      query = query.is('reservation_id', null).eq('from_address', fromAddress);
    } else {
      query = query.is('reservation_id', null).order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) return json(500, { error: 'Laden fehlgeschlagen.' });
    return json(200, { emails: data });
  }

  if (event.httpMethod === 'PATCH') {
    const { ids } = JSON.parse(event.body || '{}');
    if (!ids || !ids.length) return json(400, { error: 'ids erforderlich.' });
    const { error } = await supabaseAdmin.from('emails').update({ is_read: true }).in('id', ids);
    if (error) return json(500, { error: 'Speichern fehlgeschlagen.' });
    return json(200, { success: true });
  }

  return json(405, { error: 'Method Not Allowed' });
};
