# Apple Erinnerungen auf dem Spiegel

Apple bietet keine Schnittstelle für Erinnerungen, und seit iOS 13 laufen sie nicht mehr über CalDAV. Deshalb schickt ein **Kurzbefehl** auf iPhone, iPad oder Mac die offenen Erinnerungen an den Spiegel. Das Modul *Aufgaben & Einkaufsliste* zeigt dann den zuletzt empfangenen Stand.

[English guide](apple-reminders.md)

## 1. Modul einrichten

1. Admin-Panel → *Module* → *Aufgaben & Einkaufsliste* anlegen (oder das vorhandene öffnen).
2. **Quelle:** *Apple Erinnerungen (Kurzbefehle)*.
3. Den angezeigten **Token** kopieren. Er wird automatisch erzeugt und ist das Passwort für den Kurzbefehl.
4. Speichern.

Du brauchst gleich drei Angaben:

| Platzhalter | Beispiel |
|---|---|
| `SPIEGEL_URL` | `http://mirror.local:8080/api/push/tasks` (Adresse deines Spiegels + `/api/push/tasks`) |
| `TOKEN` | der Token aus Schritt 3 |
| `LISTE` | Name deiner Erinnerungsliste, z. B. `Einkauf` – oder `alle` |

## 2. Kurzbefehl per KI erstellen lassen

Kurzbefehle lassen sich inzwischen aus einer Beschreibung erstellen, zum Beispiel mit Apple Intelligence in der Kurzbefehle-App oder mit einem KI-Assistenten, der dir die Aktionen Schritt für Schritt baut. Ersetze die drei Platzhalter und gib diesen Text ein:

```text
Erstelle einen Kurzbefehl namens "Erinnerungen → Spiegel":

1. Suche alle Erinnerungen, die NICHT erledigt sind, aus der Liste "LISTE"
   (bei "alle": aus allen Listen), sortiert nach Fälligkeitsdatum.
2. Wiederhole für jede gefundene Erinnerung: Erzeuge einen Text im Format
   Titel | Fälligkeitsdatum | Priorität
   – Fälligkeitsdatum im Format ISO 8601 (leer lassen, wenn keins gesetzt ist),
   – Priorität als Keine/Niedrig/Mittel/Hoch.
3. Kombiniere die Ergebnisse der Wiederholung zu einem Text, getrennt durch neue Zeilen.
4. Sende diesen Text mit "Inhalte von URL abrufen" an SPIEGEL_URL:
   Methode POST, Header "Authorization" mit dem Wert "Bearer TOKEN",
   Hauptteil der Anfrage: Datei = der kombinierte Text.

Lege außerdem zwei persönliche Automationen an, die diesen Kurzbefehl
sofort ausführen, ohne nachzufragen und ohne Benachrichtigung:
a) wenn die App "Erinnerungen" geschlossen wird,
b) täglich um 6:00 Uhr.
```

Danach den Kurzbefehl einmal mit ▶ starten. Als Antwort kommt `{"ok":true,"received":…}`, und das Modul auf dem Spiegel aktualisiert sich sofort.

> **Tipp:** Kontrolliere die erzeugten Aktionen kurz. KI-Assistenten vertauschen gelegentlich Header-Name und -Wert oder lassen das Datumsformat weg. Wie es richtig aussieht, steht unten.

## 3. Manuell (falls die KI nicht hilft)

In der App **Kurzbefehle** einen neuen Kurzbefehl mit diesen Aktionen anlegen:

1. **Erinnerungen suchen**: Filter *Ist erledigt* ist *nicht aktiviert*, optional *Liste* ist *Einkauf*, sortiert nach *Fälligkeitsdatum*.
2. **Wiederholen mit jedem Objekt** (Eingabe: *Erinnerungen*), darin eine Aktion **Text**:
   ```
   [Wiederholungsobjekt › Titel] | [Wiederholungsobjekt › Fälligkeitsdatum] | [Wiederholungsobjekt › Priorität]
   ```
   Beim Fälligkeitsdatum die Variable antippen und **Datumsformat → ISO 8601** wählen.
3. Nach *Wiederholung beenden*: **Text kombinieren** – *Wiederholungsergebnisse*, Trennzeichen *Neue Zeilen*.
4. **Inhalte von URL abrufen**: URL `SPIEGEL_URL`, Methode **POST**, Header `Authorization` = `Bearer TOKEN`, Hauptteil **Datei** → *Kombinierter Text*.

**Automation:** Kurzbefehle → **Automation** → **+** → *App* → *Erinnerungen* → *Wird geschlossen* (und optional *Tageszeit* 6:00) → **Sofort ausführen**, *Bei Ausführung benachrichtigen* aus → deinen Kurzbefehl wählen.

> **Ganz einfache Variante:** Wenn dir die Titel reichen, lass die Wiederholung weg und kombiniere direkt die gefundenen Erinnerungen per **Text kombinieren**.

## Gut zu wissen

- Das Handy muss den Spiegel erreichen, also im Heim-WLAN sein. Unterwegs geht es nur per VPN oder über einen Reverse-Proxy mit `https://`.
- Der Spiegel behält die zuletzt empfangene Liste, auch nach einem Neustart. Kommt länger als eingestellt nichts Neues, zeigt das Modul klein „Stand: …“.
- Formate, die der Spiegel versteht:
  - Zeilen: `Titel | Fällig | Priorität`. Fälligkeit als `2026-10-28` (ganztägig) oder ISO 8601 mit Uhrzeit, Priorität als Hoch/Mittel/Niedrig, High/Medium/Low oder Apples Zahlen 1–9.
  - JSON: `["Milch", …]` oder `{"items":[{"title":…,"due":…}]}`.
- Test vom Rechner aus:
  ```bash
  curl -X POST -H "Authorization: Bearer TOKEN" --data-binary $'Milch\nBrot | 2026-10-28' SPIEGEL_URL
  ```
- Ein neuer Token im Admin-Panel sperrt alte Kurzbefehle aus.
