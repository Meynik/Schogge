# Supabase-Setup fuer den Online-Modus

Der lokale Schogge-Modus funktioniert ohne Supabase. Fuer Online-Spiele brauchst du ein Supabase-Projekt.

## 1. Supabase-Projekt anlegen

1. Oeffne https://supabase.com.
2. Erstelle ein neues Projekt.
3. Oeffne im Projekt den Bereich `SQL Editor`.
4. Kopiere den kompletten Inhalt aus `supabase/schema.sql` hinein.
5. Fuehre das SQL aus.

Dadurch entstehen:

- `schogge_rooms`: speichert Lobby, Raumcode und Spielstand.
- `schogge_players`: speichert Spieler pro Raum und Anwesenheit.
- RPC-Funktionen wie `schogge_create_room`, `schogge_join_room`, `schogge_roll` und `schogge_accept_turn`.

Die RPC-Funktionen pruefen zentral, wer am Zug ist, ob ein Wurf erlaubt ist, Pflichtwuerfe, Ergebnisuebernahme, Zugwechsel und Rundenauswertung. Schreibzugriffe laufen ueber gesperrte Raum-Datensaetze, damit zwei Geraete nicht gleichzeitig widerspruechliche Zustaende schreiben.

## 2. API-Werte kopieren

Oeffne in Supabase:

`Project Settings` -> `API`

Kopiere:

- `Project URL`
- `anon public` Key

Trage die Werte in `supabase-config.js` ein:

```js
window.SCHOGGE_SUPABASE_CONFIG = {
  url: "https://dein-projekt.supabase.co",
  anonKey: "dein-anon-public-key",
};
```

Wichtig: Verwende niemals den `service_role` Key im Browser. Fuer diese Web-App ist nur der public anon Key vorgesehen.

## 3. GitHub Pages

Lade danach auch diese Dateien hoch:

- `supabase-config.js`
- `supabase/schema.sql`
- `SUPABASE_SETUP.md`

Wenn du `supabase-config.js` oeffentlich auf GitHub Pages hochlaedst, ist der anon Key sichtbar. Das ist bei Supabase normal, solange die Tabellen ueber Policies und RPC-Funktionen abgesichert sind. Der geheime `service_role` Key darf dort nie stehen.

## 4. Raeume und Ablauf

- Raeume werden mit kurzem Code wie `SCHOGGE1234` erstellt.
- Spieler brauchen kein Konto.
- Der Browser speichert Raum-ID, Spieler-ID und Spieler-Token lokal, damit ein Neuladen wieder in den Raum fuehrt.
- Raeume laufen nach 12 Stunden ab.

## 5. Erste Fehlersuche

- Online-Buttons sind deaktiviert: `supabase-config.js` hat noch leere Werte oder der Supabase-Client konnte nicht geladen werden.
- Raumcode existiert nicht: Code pruefen oder Raum ist abgelaufen.
- Aktion nicht erlaubt: Du bist nicht am Zug oder ein Pflichtwurf ist offen.
- Aenderungen erscheinen nicht: pruefe in Supabase, ob Realtime fuer die Tabellen aktiv ist.
