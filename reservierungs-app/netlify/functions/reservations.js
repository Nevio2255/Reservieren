const { supabaseAdmin, getSession, json } = require('./_lib');

// Wählt reihum den nächsten Mitarbeiter für eine neue Reservierung aus.
async function pickNextEmployee() {
  const { data: employees } = await supabaseAdmin
    .from('employees')
    .select('id, name')
    .order('created_at', { ascending: true });
  if (!employees || !employees.length) return null;

  const { data: state } = await supabaseAdmin.from('assignment_state').select('*').eq('id', 1).maybeSingle();
  const lastId = state?.last_employee_id;
  const lastIndex = employees.findIndex((e) => e.id === lastId);
  const next = employees[(lastIndex + 1) % employees.length];

  await supabaseAdmin.from('assignment_state').update({ last_employee_id: next.id }).eq('id', 1);
  return next;
}

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return json(500, { error: 'Laden fehlgeschlagen.' });

    const { data: employees } = await supabaseAdmin.from('employees').select('id, name');
    const nameMap = Object.fromEntries((employees || []).map((e) => [e.id, e.name]));
    const withNames = (data || []).map((r) => ({ ...r, assigned_employee_name: nameMap[r.assigned_employee_id] || null }));

    return json(200, { reservations: withNames });
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { product, reservation_number, customer_name, customer_email, customer_phone, quantity, price, notes } = body;
    if (!product || !reservation_number || !customer_name || !customer_email || !quantity || price === undefined) {
      return json(400, { error: 'Bitte alle Pflichtfelder ausfüllen.' });
    }

    const assignedEmployee = await pickNextEmployee();

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
      assigned_employee_id: assignedEmployee?.id || null,
    });

    if (error) {
      console.error('Reservierung speichern fehlgeschlagen:', error);
      if (error.code === '23505') return json(409, { error: 'Diese Reservierungsnummer gibt es schon.' });
      return json(500, { error: `Speichern fehlgeschlagen: ${error.message || error.code || 'unbekannter Fehler'}` });
    }
    return json(200, { success: true, assignedTo: assignedEmployee?.name || null });
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
