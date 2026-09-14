const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return json(500, { error: 'Laden fehlgeschlagen.' });
    return json(200, { reservations: data });
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { product, reservation_number, customer_name, customer_email, customer_phone, quantity, price, notes } = body;
    if (!product || !reservation_number || !customer_name || !customer_email || !quantity || price === undefined) {
      return json(400, { error: 'Bitte alle Pflichtfelder ausfüllen.' });
    }

    const { error } = await supabaseAdmin.from('reservations').insert({
      product,
      reservation_number,
      customer_name,
      customer_email,
      customer_phone: customer_phone || null,
      quantity,
      price,
      notes: notes || null,
      created_by: session.name,
    });

    if (error) {
      if (error.code === '23505') return json(409, { error: 'Diese Reservierungsnummer gibt es schon.' });
      return json(500, { error: 'Speichern fehlgeschlagen.' });
    }
    return json(200, { success: true });
  }

  if (event.httpMethod === 'PATCH') {
    const { id, status } = JSON.parse(event.body || '{}');
    if (!id || !status) return json(400, { error: 'id und status erforderlich.' });
    const { error } = await supabaseAdmin.from('reservations').update({ status }).eq('id', id);
    if (error) return json(500, { error: 'Speichern fehlgeschlagen.' });
    return json(200, { success: true });
  }

  if (event.httpMethod === 'DELETE') {
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return json(400, { error: 'id erforderlich.' });
    const { error } = await supabaseAdmin.from('reservations').delete().eq('id', id);
    if (error) return json(500, { error: 'Löschen fehlgeschlagen.' });
    return json(200, { success: true });
  }

  return json(405, { error: 'Method Not Allowed' });
};
