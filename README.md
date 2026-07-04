# Schogge Web-App

Eine mobile, installierbare Web-App für das private Würfelspiel Schogge. Die App nutzt nur HTML, CSS und modernes JavaScript. Spielstand, Namen und Verlauf bleiben per `localStorage` auf dem Gerät.

## Dateien

- `index.html` - Einstieg der App
- `styles.css` - mobile Oberfläche und Würfeldesign
- `app.js` - Spielregeln, Zustand und Benutzeroberfläche
- `manifest.webmanifest` - PWA-Metadaten
- `service-worker.js` - Offline-Cache für die App-Dateien
- `icon.svg` - lokales App-Icon
- `test-rules.js` - ausführbare Tests für die Wertungslogik

## Lokal starten

Auf Windows ohne zusätzliche Installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1 -Port 4173
```

Dann im Browser öffnen:

```text
http://localhost:4173/
```

Alternativ funktioniert auch jeder andere kleine Webserver, zum Beispiel `python -m http.server 4173` oder die Live-Server-Funktion eines Editors. Für Service Worker und Installation als PWA muss die App über `http://localhost`, `http://127.0.0.1` oder HTTPS laufen; direktes Öffnen der Datei reicht dafür nicht.

## Tests ausführen

```powershell
node test-rules.js
```

Die Tests prüfen Kategorien, Rangfolge, den Sonderfall 531, Schogge aus im ersten und späteren Wurf, die Doppel-Sechs-Regel, Gleichstand und Glasrunden.

## GitHub Pages

1. Neues GitHub-Repository erstellen.
2. Alle Dateien aus diesem Ordner in das Repository hochladen oder committen.
3. In GitHub zu `Settings` > `Pages` gehen.
4. Unter `Build and deployment` die Quelle `Deploy from a branch` wählen.
5. Branch `main` und Ordner `/root` auswählen, dann speichern.
6. Die angezeigte GitHub-Pages-Adresse auf dem iPhone in Safari öffnen.
7. In Safari `Teilen` antippen und `Zum Home-Bildschirm` wählen.

Nach Updates kann der Service Worker noch kurz alte Dateien halten. Wenn etwas veraltet wirkt, die Seite einmal neu laden oder die App vom Home-Bildschirm entfernen und erneut hinzufügen.
