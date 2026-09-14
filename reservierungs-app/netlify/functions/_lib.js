// Gemeinsame Hilfsfunktionen für alle Netlify Functions.
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

function signSession(employee) {
  return jwt.sign(
    { id: employee.id, code: employee.employee_code, name: employee.name, role: employee.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Liest und prüft den Bearer-Token aus dem Request. Gibt die Session zurück
// oder null, wenn keine gültige Anmeldung vorliegt.
function getSession(event) {
  const header = event.headers.authorization || event.headers.Authorization;
  if (!header) return null;
  const token = header.replace('Bearer ', '');
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

// Prüft den Wartungsmodus. Der Owner ist nie betroffen. Für alle anderen
// Rollen wird bei aktivem Wartungsmodus eine 423-Antwort zurückgegeben, die
// der Aufrufer direkt als Response durchreichen kann; sonst null.
async function checkMaintenance(session) {
  if (!session || session.role === 'owner') return null;
  const { data } = await supabaseAdmin
    .from('system_state')
    .select('maintenance_mode')
    .eq('id', 1)
    .maybeSingle();
  if (data?.maintenance_mode) {
    return json(423, {
      error: 'Der Inhaber bearbeitet gerade das System. Bitte versuche es später erneut.',
      maintenance: true,
    });
  }
  return null;
}

module.exports = { supabaseAdmin, signSession, getSession, json, bcrypt, checkMaintenance };
