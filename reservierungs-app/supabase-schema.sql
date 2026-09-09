-- ============================================
-- Schema für das Reservierungs-Verwaltungsprogramm
-- Einfach im Supabase Dashboard unter "SQL Editor" einfügen und ausführen
--
-- Wichtig: Der Login läuft NICHT über Supabase Auth, sondern über eine eigene
-- "employees"-Tabelle mit Zugangscode + Passwort. Der Zugriff auf ALLE Tabellen
-- läuft ausschließlich über die Netlify Functions (mit dem service_role Key,
-- der die Row-Level-Security umgeht). Aus dem Browser gibt es daher gar keinen
-- direkten Datenbankzugriff mehr -- das ist sicherer, als es über RLS-Regeln
-- für einen frei sichtbaren "anon key" zu lösen.
-- ============================================

create extension if not exists "pgcrypto";

-- Tabelle: Mitarbeiter- und Owner-Konten
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  name text not null,
  password_hash text, -- NULL = Konto wurde angelegt, Passwort aber noch nicht vergeben
  salary numeric(10,2),
  role text not null default 'mitarbeiter', -- 'owner' oder 'mitarbeiter'
  created_at timestamptz not null default now()
);

-- Tabelle: offene "Passwort vergessen"-Anfragen mit Code, den der Chef weitergibt
create table if not exists password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  reset_code text not null,
  expires_at timestamptz not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Tabelle: E-Mail-Vorlagen (vom Owner verwaltbar)
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  subject text not null,
  body text not null,
  is_chat_invite boolean not null default false,
  created_at timestamptz not null default now()
);

-- Vier Standard-Vorlagen + eine Live-Chat-Einladung vorbelegen
insert into email_templates (label, subject, body) values
  ('Bestätigung', 'Deine Reservierung {{reservation_number}} ist bestätigt',
   E'Hallo {{customer_name}},\n\nvielen Dank für deine Reservierung von {{product}} (Stückzahl: {{quantity}}) bei LuxeFinds.\n\nReservierungsnummer: {{reservation_number}}\nGesamtpreis: {{total}}\n\nWir melden uns, sobald deine Bestellung abholbereit ist.\n\nViele Grüße\nLuxeFinds'),
  ('Zahlungserinnerung', 'Zahlungserinnerung für Reservierung {{reservation_number}}',
   E'Hallo {{customer_name}},\n\nkurze Erinnerung: für deine Reservierung {{reservation_number}} (Betrag: {{total}}) steht die Zahlung noch aus.\n\nBitte melde dich bei Fragen gerne bei uns.\n\nViele Grüße\nLuxeFinds'),
  ('Abholbereit', 'Deine Reservierung {{reservation_number}} ist abholbereit',
   E'Hallo {{customer_name}},\n\ndeine Reservierung von {{product}} ist ab sofort abholbereit.\n\nReservierungsnummer: {{reservation_number}}\n\nWir freuen uns auf dich!\n\nViele Grüße\nLuxeFinds'),
  ('Stornierung', 'Deine Reservierung {{reservation_number}} wurde storniert',
   E'Hallo {{customer_name}},\n\nwir bestätigen die Stornierung deiner Reservierung {{reservation_number}} über {{product}}.\n\nBei Fragen melde dich gerne bei uns.\n\nViele Grüße\nLuxeFinds')
on conflict (label) do nothing;

insert into email_templates (label, subject, body, is_chat_invite) values
  ('Live-Chat einladen', 'Lass uns direkt chatten – Reservierung {{reservation_number}}',
   E'Hallo {{customer_name}},\n\ngerne laden wir dich zum Live-Chat ein, damit wir schneller mit dir schreiben können.\n\nHier geht''s zum Chat: {{chat_link}}\n\nWir freuen uns auf dich!\n\nViele Grüße\nLuxeFinds', true)
on conflict (label) do nothing;

-- Owner-Konto anlegen: Zugangscode "LuxeFinds", Passwort wird beim ersten Login
-- selbst über "Erstes Mal hier? Passwort festlegen" vergeben.
insert into employees (employee_code, name, role)
values ('LuxeFinds', 'Inhaber', 'owner')
on conflict (employee_code) do nothing;

-- Tabelle: Reservierungen
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  product text not null,
  reservation_number text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  price numeric(10,2) not null default 0,
  quantity integer not null default 1,
  status text not null default 'offen', -- offen / bezahlt / storniert / abgeholt
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservations_email on reservations (customer_email);
create index if not exists idx_reservations_number on reservations (reservation_number);

-- Tabelle: Live-Chat-Sitzungen (eine pro Reservierung + einladendem Mitarbeiter)
create table if not exists live_chats (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  employee_id uuid not null references employees(id),
  token text not null unique,
  status text not null default 'open', -- 'open' oder 'closed'
  closed_by text, -- 'employee' oder 'customer'
  verified boolean not null default false,
  verification_code text,
  verification_expires_at timestamptz,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  customer_joined_at timestamptz -- wird gesetzt, sobald der Kunde den Chat-Link zum ersten Mal öffnet
);
create index if not exists idx_live_chats_reservation on live_chats (reservation_id);

-- Migration für bereits bestehende Datenbanken (auf neuen Installationen ist die Spalte
-- bereits über das create table oben vorhanden, dieser Befehl ist dann einfach ein No-Op):
alter table live_chats add column if not exists customer_joined_at timestamptz;

-- Tabelle: Chat-Nachrichten
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references live_chats(id) on delete cascade,
  sender text not null, -- 'customer' oder 'staff'
  sender_name text,
  body text not null,
  request_type text, -- null, 'address', 'reservation_number', 'name', 'verification'
  read_by_staff boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_chat on chat_messages (chat_id, created_at);

-- Tabelle: E-Mail-Verlauf (gesendet + empfangen)
create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references reservations(id) on delete set null,
  direction text not null, -- 'out' = gesendet, 'in' = empfangen
  from_address text not null,
  to_address text not null,
  subject text,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_emails_reservation on emails (reservation_id);
create index if not exists idx_emails_created on emails (created_at desc);

-- Tabelle: merkt sich, bis zu welcher IMAP-UID schon abgeholt wurde
create table if not exists mail_sync_state (
  id int primary key default 1,
  last_uid bigint not null default 0
);
insert into mail_sync_state (id, last_uid) values (1, 0) on conflict (id) do nothing;

-- Row Level Security aktivieren -- bewusst OHNE Policies für "anon"/"authenticated".
-- Das sperrt jeden direkten Zugriff aus dem Browser komplett zu. Die Netlify
-- Functions verwenden den service_role Key, der RLS ohnehin umgeht.
alter table reservations enable row level security;
alter table emails enable row level security;
alter table mail_sync_state enable row level security;
alter table employees enable row level security;
alter table password_reset_requests enable row level security;
alter table email_templates enable row level security;
alter table live_chats enable row level security;
alter table chat_messages enable row level security;
