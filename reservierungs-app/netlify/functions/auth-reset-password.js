const { supabaseAdmin, json, bcrypt } = require('./_lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const { code, resetCode, newPassword } = JSON.parse(event.body || '{}');
  if (!code || !resetCode || !newPassword) {
    return json(400, { error: 'Zugangscode, Reset-Code und neues Passwort erforderlich.' });
  }
  if (newPassword.length < 8) return json(400, { error: 'Passwort muss mindestens 8 Zeichen haben.' });

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .ilike('employee_code', code)
    .maybeSingle();
  if (!employee) return json(404, { error: 'Zugangscode nicht gefunden.' });

  const { data: request } = await supabaseAdmin
    .from('password_reset_requests')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('reset_code', resetCode)
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!request) return json(401, { error: 'Reset-Code falsch oder bereits verwendet.' });
  if (new Date(request.expires_at) < new Date()) {
    return json(401, { error: 'Reset-Code abgelaufen. Bitte neu anfordern.' });
  }

  const password_hash = await bcrypt.hash(newPassword, 10);
  await supabaseAdmin.from('employees').update({ password_hash }).eq('id', employee.id);
  await supabaseAdmin.from('password_reset_requests').update({ resolved: true }).eq('id', request.id);

  return json(200, { message: 'Passwort wurde geändert. Du kannst dich jetzt anmelden.' });
};
