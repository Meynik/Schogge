# Schogge Web-App

Eine mobile, installierbare Web-App fuer das private Wuerfelspiel Schogge. Der lokale Modus speichert Spielstand, Namen und Verlauf per `localStorage` auf dem Geraet. Zusaetzlich gibt es einen optionalen Online-Modus mit Supabase.

## Dateien

- `index.html` - Einstieg der App
- `styles.css` - mobile Oberflaeche und Wuerfeldesign
- `app.js` - Spielregeln, Zustand, lokaler Modus und Online-UI
- `manifest.webmanifest` - PWA-Metadaten
- `service-worker.js` - Offline-Cache fuer die App-Dateien
- `icon.svg` - lokales App-Icon
- `test-rules.js` - ausfuehrbare Tests fuer die Wertungslogik
- `supabase-config.js` - Browser-Konfiguration fuer den Online-Modus
- `supabase/schema.sql` - Supabase-Tabellen und RPC-Funktionen fuer Online-Spiele
- `SUPABASE_SETUP.md` - Einrichtung des Supabase-Backends

## Lokal starten

Auf Windows ohne zusaetzliche Installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1 -Port 4173
```

Dann im Browser oeffnen:

```text
http://localhost:4173/
```

Alternativ funktioniert jeder andere kleine Webserver. Fuer Service Worker und Installation als PWA muss die App ueber `http://localhost`, `http://127.0.0.1` oder HTTPS laufen.

## Tests ausfuehren

```powershell
node test-rules.js
```

Die Tests pruefen Kategorien, Rangfolge, 531, Schogge aus, Doppel-Sechs, Pflichtwuerfe, Gleichstand und Glasrunden.

## Online-Modus mit Supabase

Der lokale Modus funktioniert weiterhin ohne Supabase. Fuer Online-Spiele:

1. In Supabase ein Projekt erstellen.
2. Den Inhalt von `supabase/schema.sql` im Supabase SQL Editor ausfuehren.
3. In `supabase-config.js` die `Project URL` und den `anon public` Key eintragen.
4. Die App neu laden.

Details stehen in `SUPABASE_SETUP.md`.

## GitHub Pages

1. Neues GitHub-Repository erstellen.
2. Alle Dateien aus diesem Ordner in das Repository hochladen oder committen.
3. In GitHub zu `Settings` > `Pages` gehen.
4. Unter `Build and deployment` die Quelle `Deploy from a branch` waehlen.
5. Branch `main` und Ordner `/(root)` auswaehlen, dann speichern.
6. Die angezeigte GitHub-Pages-Adresse auf dem iPhone in Safari oeffnen.
7. In Safari `Teilen` antippen und `Zum Home-Bildschirm` waehlen.

Nach Updates kann der Service Worker noch kurz alte Dateien halten. Wenn etwas veraltet wirkt, die Seite einmal neu laden oder die App vom Home-Bildschirm entfernen und erneut hinzufuegen.
