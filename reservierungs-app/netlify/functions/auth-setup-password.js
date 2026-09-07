const { supabaseAdmin, signSession, json, bcrypt } = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const { code, password } = JSON.parse(event.body || '{}');
  if (!code || !password) return json(400, { error: 'Zugangscode und Passwort erforderlich.' });
  if (password.length < 8) return json(400, { error: 'Passwort muss mindestens 8 Zeichen haben.' });

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .ilike('employee_code', code)
    .maybeSingle();

  if (!employee) return json(404, { error: 'Zugangscode nicht gefunden. Bitte beim Chef nachfragen.' });
  if (employee.password_hash) {
    return json(409, { error: 'Für diesen Zugangscode wurde bereits ein Passwort festgelegt. Nutze "Passwort vergessen".' });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabaseAdmin.from('employees').update({ password_hash }).eq('id', employee.id);
  if (error) return json(500, { error: 'Speichern fehlgeschlagen.' });

  const token = signSession({ ...employee, password_hash });
  return json(200, { token, name: employee.name, role: employee.role, code: employee.employee_code });
};
