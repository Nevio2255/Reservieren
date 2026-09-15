const { supabaseAdmin, json } = require('./_lib');

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-stelliger Code
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const { code } = JSON.parse(event.body || '{}');
  if (!code) return json(400, { error: 'Zugangscode erforderlich.' });

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .ilike('employee_code', code)
    .maybeSingle();

  // Bewusst immer dieselbe Erfolgsmeldung, egal ob der Code existiert oder nicht.
  if (employee) {
    const reset_code = randomCode();
    const expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 Minuten gültig

    await supabaseAdmin.from('password_reset_requests').insert({
      employee_id: employee.id,
      reset_code,
      expires_at,
    });
  }

  return json(200, {
    message: 'Anfrage gesendet. Dein Chef sieht den Code im Mitarbeiter-Bereich und gibt ihn dir weiter.',
  });
};
