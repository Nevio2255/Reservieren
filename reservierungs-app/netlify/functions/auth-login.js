const { supabaseAdmin, signSession, json, bcrypt } = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const { code, password } = JSON.parse(event.body || '{}');
  if (!code || !password) return json(400, { error: 'Zugangscode und Passwort erforderlich.' });

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .ilike('employee_code', code)
    .maybeSingle();

  if (!employee || !employee.password_hash) {
    return json(401, { error: 'Zugangscode oder Passwort falsch.' });
  }

  const valid = await bcrypt.compare(password, employee.password_hash);
  if (!valid) return json(401, { error: 'Zugangscode oder Passwort falsch.' });

  const token = signSession(employee);
  return json(200, {
    token,
    name: employee.name,
    role: employee.role,
    code: employee.employee_code,
    salary: employee.salary,
  });
};
