# LuxeFinds Verwaltung — Setup

Verwaltungsprogramm für Reservierungen: Mitarbeiter sehen alle Reservierungen,
legen neue an, schreiben Kunden direkt E-Mails und bekommen Antworten
automatisch angezeigt. Eigenes Login-System mit Zugangscode statt E-Mail,
Mitarbeiterverwaltung mit Lohn, und Passwort-vergessen mit Code-Weitergabe
durch dich.

Weil E-Mail-Versand/-Empfang, Login und die Datenbank Server-Code brauchen,
**reicht reines Drag & Drop auf Netlify nicht** — das Projekt muss über GitHub
mit Netlify verbunden werden (einmalig, ca. 5 Minuten, danach läuft alles
automatisch bei jedem Update).

---

## 1. Supabase einrichten (Datenbank) — kostenlos

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto/Projekt anlegen.
2. Im Projekt → **SQL Editor** → Inhalt von `supabase-schema.sql` einfügen und ausführen.
   Das legt alle Tabellen an, inkl. deines Owner-Kontos mit Zugangscode `LuxeFinds`.
3. Unter **Project Settings → API** zwei Werte kopieren (für Schritt 3 unten):
   - `Project URL`
   - `service_role` Key — **streng geheim halten!** Nur in Netlify eintragen, nirgendwo sonst.

   Den `anon public` Key brauchst du für dieses Projekt **nicht** — der Browser hat
   keinen direkten Datenbankzugriff mehr, alles läuft über die Netlify Functions.

## 2. Gmail App-Passwort erstellen

1. Bei Google einloggen → [myaccount.google.com/security](https://myaccount.google.com/security)
   → **2-Schritt-Verifizierung** muss aktiviert sein (Voraussetzung für App-Passwörter).
2. Dann unter **App-Passwörter** (Suche in den Kontoeinstellungen nach
   "App-Passwörter" oder direkt [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords))
   ein neues App-Passwort erstellen (App: "Mail", Gerät: z. B. "LuxeFinds").
3. Das erzeugte 16-stellige App-Passwort notieren (nicht das normale
   Google-Login-Passwort!). IMAP muss zusätzlich unter Gmail →
   **Einstellungen → Weiterleitung und POP/IMAP → IMAP aktivieren** eingeschaltet sein.

## 3. Code in ein GitHub-Repository hochladen

1. Auf [github.com](https://github.com) ein neues, **privates** Repository erstellen.
2. Diesen kompletten Ordner hochladen (auch ohne Git-Kenntnisse per "Upload files"
   in der GitHub-Weboberfläche möglich — einfach alle Dateien reinziehen).

## 4. Mit Netlify verbinden

1. Auf [app.netlify.com](https://app.netlify.com) → **Add new site → Import an
   existing project → GitHub** → das Repository auswählen.
2. Build-Einstellungen: Build command leer lassen, Publish directory: `.`
3. Unter **Site configuration → Environment variables** die 5 Werte aus
   `.env.example` eintragen (siehe unten).
4. **Deploy site** klicken. Danach läuft `fetch-emails` automatisch alle 10
   Minuten im Hintergrund und holt neue Kunden-Mails ab.

---

## Erster Login (Owner)

Zugangscode: **LuxeFinds**

Ein Passwort ist noch nicht vergeben. Auf der Login-Seite auf
**„Erstes Mal hier? Passwort festlegen"** klicken, Code `LuxeFinds` eingeben
und ein eigenes Passwort setzen. Ein vorgeschlagenes starkes Passwort:

```
9yt6sg0Qg@B1pf%U
```

(Du kannst genauso gut dein eigenes wählen — das ist nur ein Vorschlag.)

## Mitarbeiter anlegen

1. Als Owner einloggen → **Mitarbeiter** → **+ Mitarbeiter anlegen** → Zugangscode,
   Name und Lohn eintragen.
2. Den Zugangscode persönlich an den Mitarbeiter weitergeben (z. B. mündlich, SMS).
3. Der Mitarbeiter geht auf die Login-Seite → **„Erstes Mal hier?"** → Code
   eingeben → eigenes Passwort festlegen. Fertig, er ist eingeloggt.
4. Mitarbeiter sehen ihren eigenen Lohn unter **Mein Profil**, aber keine Löhne
   anderer — die Mitarbeiterverwaltung ist nur für dich (Owner) sichtbar.

## Passwort vergessen

1. Mitarbeiter klickt auf der Login-Seite **„Passwort vergessen?"** und gibt
   seinen Zugangscode ein.
2. Du siehst als Owner unter **Mitarbeiter → Offene Passwort-Anfragen** sofort
   einen 6-stelligen Code (30 Minuten gültig).
3. Du gibst diesen Code dem Mitarbeiter mündlich/per Nachricht weiter.
4. Mitarbeiter klickt auf **„Ich habe schon einen Code"**, gibt Zugangscode +
   Code + neues Passwort ein → fertig.

Alternativ kannst du als Owner jederzeit direkt ein neues Passwort für
jeden Mitarbeiter setzen (**Mitarbeiter → Passwort setzen**), ganz ohne Code.

---

## Wie es funktioniert

- **Reservierung anlegen**: Formular in der App → direkt in Supabase gespeichert,
  von allen Mitarbeitern sofort sichtbar.
- **E-Mail senden**: Compose-Feld in der Detailansicht einer Reservierung →
  verschickt über dein Gmail-Postfach → wird im Verlauf gespeichert.
- **E-Mail empfangen**: alle 10 Minuten prüft eine automatische Funktion das
  Gmail-Postfach, ordnet neue Mails per Absenderadresse der passenden
  Reservierung zu. Mails von unbekannten Absendern landen im **Posteingang**.
- **Login**: eigenes System mit Zugangscode + Passwort (keine E-Mail-Adressen
  nötig), Sitzungen laufen über ein signiertes Token, das 30 Tage gültig ist.

## Intervall für den Mail-Abruf ändern

Standardmäßig alle 10 Minuten. Ändern in `netlify.toml`:

```toml
[functions."fetch-emails"]
  schedule = "*/10 * * * *"   # z. B. "*/5 * * * *" für alle 5 Minuten
```

## Live-Chat mit Kunden

Wenn ein Mitarbeiter in einer Reservierung die Vorlage **„Live-Chat einladen"** anklickt,
wird automatisch ein Chat erstellt und der Link in die E-Mail eingesetzt. Der Kunde
klickt den Link, landet auf einer eigenen Chat-Seite (ohne Login) und kann direkt
mit dir schreiben.

- Der Chat läuft alle 4 Sekunden automatisch aktuell (kein Extra-Setup nötig).
- Nur **du (Owner)** und der **Mitarbeiter, der die Einladung verschickt hat**, sehen
  diesen Chat unter „Live-Chats" — andere Mitarbeiter sehen weiterhin den normalen
  E-Mail-Verlauf der Reservierung, aber nicht diesen Chat.
- Der Chat bleibt offen, bis du **oder** der Kunde auf „Chat beenden" klickt.
- E-Mails haben jetzt ein richtiges Design mit eurem LuxeFinds-Logo, und Links im
  Text (wie der Chat-Link) werden automatisch zu einem Button.

Damit das Logo in E-Mails und der Chat-Link korrekt funktionieren, muss `SITE_URL`
in den Umgebungsvariablen gesetzt sein (siehe `.env.example`) — die öffentliche
Adresse deiner Netlify-Seite, z. B. `https://luxefinds-reservation-app.netlify.app`.

### Automatische Begrüßung & Verifizierung

Sobald ein Chat erstellt wird, schreibt „LuxeFinds" automatisch eine Begrüßung mit
allen Reservierungen des Kunden (per E-Mail-Adresse abgeglichen). Der Kunde kann
aber **erst schreiben, nachdem der Mitarbeiter auf „Verifizierungscode senden"
geklickt hat** und der Kunde den per E-Mail erhaltenen 6-stelligen Code im Chat
eingegeben hat. Danach hat der Mitarbeiter zusätzlich Schnellaktions-Buttons
(„Adresse anfordern", „Reservierungsnummer anfordern", „Name anfordern") — der
Kunde bekommt dafür ein kleines Formular als Pop-up im Chat.

## Design anpassen

Farben, Schriften und Abstände liegen zentral in `css/style.css` (Variablen
ganz oben unter `:root`). Wenn du mir den Code oder die Farben/Fonts deiner
LuxeFinds-Hauptseite gibst, gleiche ich das Design exakt an.
