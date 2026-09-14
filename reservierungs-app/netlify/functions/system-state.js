// Netlify Function: /.netlify/functions/system-state
// Liest und setzt den Wartungsmodus. GET ist für jeden eingeloggten Nutzer da
// (damit Mitarbeiter-Sitzungen erkennen, wenn sie gesperrt werden), POST darf
// nur der Inhaber.
const { supabaseAdmin, getSession, json } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });

  if (event.httpMethod === 'GET') {
    const { data } = await supabaseAdmin
      .from('system_state')
      .select('maintenance_mode, updated_by, updated_at')
      .eq('id', 1)
      .maybeSingle();
    return json(200, {
      maintenance: !!data?.maintenance_mode,
      updatedBy: data?.updated_by || null,
      updatedAt: data?.updated_at || null,
    });
  }

  if (event.httpMethod === 'POST') {
    if (session.role !== 'owner') return json(403, { error: 'Nur der Inhaber darf das.' });
    const { maintenance } = JSON.parse(event.body || '{}');

    const { error } = await supabaseAdmin
      .from('system_state')
      .update({
        maintenance_mode: !!maintenance,
        updated_by: session.name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    if (error) return json(500, { error: 'Speichern fehlgeschlagen.' });
    return json(200, { success: true, maintenance: !!maintenance });
  }

  return json(405, { error: 'Method Not Allowed' });
};
