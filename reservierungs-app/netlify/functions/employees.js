const { supabaseAdmin, getSession, json, bcrypt } = require('./_lib');

exports.handler = async (event) => {
  const session = getSession(event);
  if (!session) return json(401, { error: 'Nicht eingeloggt.' });
  if (session.role !== 'owner') return json(403, { error: 'Nur der Inhaber darf das.' });

  // ----- Liste aller Mitarbeiter + offene Reset-Anfragen -----
  if (event.httpMethod === 'GET') {
    const { data: employees, error: e1 } = await supabaseAdmin
      .from('employees')
      .select('id, employee_code, name, salary, role, password_hash, created_at')
      .order('created_at', { ascending: true });

    const { data: resetRequests, error: e2 } = await supabaseAdmin
      .from('password_reset_requests')
      .select('id, employee_id, reset_code, expires_at, resolved, created_at')
      .eq('resolved', false)
      .gt('expires_at', new Date().toISOString());

    if (e1 || e2) return json(500, { error: 'Laden fehlgeschlagen.' });

    const cleaned = employees.map((e) => ({
      id: e.id,
      employee_code: e.employee_code,
      name: e.name,
      salary: e.salary,
      role: e.role,
      has_password: !!e.password_hash,
      created_at: e.created_at,
    }));

    return json(200, { employees: cleaned, resetRequests: resetRequests || [] });
  }

  // ----- Neuen Mitarbeiter anlegen -----
  if (event.httpMethod === 'POST') {
    const { employee_code, name, salary } = JSON.parse(event.body || '{}');
    if (!employee_code || !name) return json(400, { error: 'Zugangscode und Name erforderlich.' });

    const { error } = await supabaseAdmin.from('employees').insert({
      employee_code,
      name,
      salary: salary || null,
      role: 'mitarbeiter',
    });

    if (error) {
      if (error.code === '23505') return json(409, { error: 'Dieser Zugangscode ist schon vergeben.' });
      return json(500, { error: 'Anlegen fehlgeschlagen.' });
    }
    return json(200, { success: true });
  }

  // ----- Mitarbeiter bearbeiten: Lohn ändern oder Passwort direkt setzen -----
  if (event.httpMethod === 'PATCH') {
    const { id, salary, newPassword } = JSON.parse(event.body || '{}');
    if (!id) return json(400, { error: 'id erforderlich.' });

    const updates = {};
    if (salary !== undefined) updates.salary = salary;
    if (newPassword) {
      if (newPassword.length < 8) return json(400, { error: 'Passwort muss mindestens 8 Zeichen haben.' });
      updates.password_hash = await bcrypt.hash(newPassword, 10);
    }
    if (Object.keys(updates).length === 0) return json(400, { error: 'Nichts zu ändern.' });

    const { error } = await supabaseAdmin.from('employees').update(updates).eq('id', id);
    if (error) return json(500, { error: 'Speichern fehlgeschlagen.' });
    return json(200, { success: true });
  }

  // ----- Mitarbeiter löschen -----
  if (event.httpMethod === 'DELETE') {
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return json(400, { error: 'id erforderlich.' });
    if (id === session.id) return json(400, { error: 'Du kannst dich nicht selbst löschen.' });

    const { error } = await supabaseAdmin.from('employees').delete().eq('id', id);
    if (error) return json(500, { error: 'Löschen fehlgeschlagen.' });
    return json(200, { success: true });
  }

  return json(405, { error: 'Method Not Allowed' });
};
