const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('email_templates')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) return json(500, { error: 'Laden fehlgeschlagen.' });
    return json(200, { templates: data });
  }

  if (session.role !== 'owner') return json(403, { error: 'Nur der Inhaber darf Vorlagen bearbeiten.' });

  if (event.httpMethod === 'POST') {
    const { label, subject, body } = JSON.parse(event.body || '{}');
    if (!label || !subject || !body) return json(400, { error: 'Name, Betreff und Text erforderlich.' });
    const { error } = await supabaseAdmin.from('email_templates').insert({ label, subject, body });
    if (error) {
      if (error.code === '23505') return json(409, { error: 'Eine Vorlage mit diesem Namen gibt es schon.' });
      return json(500, { error: 'Speichern fehlgeschlagen.' });
    }
    return json(200, { success: true });
  }

  if (event.httpMethod === 'DELETE') {
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return json(400, { error: 'id erforderlich.' });
    const { error } = await supabaseAdmin.from('email_templates').delete().eq('id', id);
    if (error) return json(500, { error: 'Löschen fehlgeschlagen.' });
    return json(200, { success: true });
  }

  return json(405, { error: 'Method Not Allowed' });
};
