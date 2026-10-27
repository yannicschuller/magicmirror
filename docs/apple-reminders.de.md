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

Die Kurzbefehle-App kann aus einer kurzen Beschreibung einen Kurzbefehl bauen. Sie mag **kurze, einfache Sätze**; bei langen Beschreibungen kommt „Versuche eine andere Beschreibung“. Ersetze die drei Platzhalter und probiere zuerst die einfache Variante:

**Einfach (nur Titel):**

```text
Finde alle nicht erledigten Erinnerungen in der Liste LISTE, kombiniere ihre Titel mit Zeilenumbrüchen und sende den Text per POST an SPIEGEL_URL mit dem Header Authorization: Bearer TOKEN.
```

**Mit Fälligkeit** (falls die einfache Variante klappt und du Termine sehen möchtest):

```text
Finde alle nicht erledigten Erinnerungen in der Liste LISTE. Erstelle für jede eine Zeile mit Titel | Fälligkeitsdatum im ISO-8601-Format. Kombiniere die Zeilen mit Zeilenumbrüchen und sende den Text per POST an SPIEGEL_URL mit dem Header Authorization: Bearer TOKEN.
```

Danach den Kurzbefehl einmal mit ▶ starten. Als Antwort kommt `{"ok":true,"received":…}`, und das Modul auf dem Spiegel aktualisiert sich sofort.

> **Wenn es nicht klappt:** Kommt weiter „Versuche eine andere Beschreibung“, oder sind die erzeugten Aktionen falsch (häufig: Header-Name und -Wert vertauscht, Hauptteil nicht als Text/Datei), baue den Kurzbefehl mit den vier Aktionen aus Abschnitt 3 – das dauert etwa zwei Minuten.

## 3. Automation einrichten (immer manuell)

Automationen kann die KI nicht anlegen. So geht es von Hand:

Kurzbefehle → **Automation** → **+**:

1. **App** → *Erinnerungen* → *Wird geschlossen* → **Sofort ausführen**, *Bei Ausführung benachrichtigen* aus → deinen Kurzbefehl wählen. Damit wird die Liste jedes Mal gesendet, wenn du die Erinnerungen-App verlässt.
2. Optional zusätzlich **Tageszeit** → täglich 6:00 → gleich einstellen, damit der Spiegel morgens aktuell ist.

## 4. Kurzbefehl manuell bauen

In der App **Kurzbefehle** einen neuen Kurzbefehl mit diesen Aktionen anlegen:

1. **Erinnerungen suchen**: Filter *Ist erledigt* ist *nicht aktiviert*, optional *Liste* ist *Einkauf*, sortiert nach *Fälligkeitsdatum*.
2. **Wiederholen mit jedem Objekt** (Eingabe: *Erinnerungen*), darin eine Aktion **Text**:
   ```
   [Wiederholungsobjekt › Titel] | [Wiederholungsobjekt › Fälligkeitsdatum] | [Wiederholungsobjekt › Priorität]
   ```
   Beim Fälligkeitsdatum die Variable antippen und **Datumsformat → ISO 8601** wählen.
3. Nach *Wiederholung beenden*: **Text kombinieren** – *Wiederholungsergebnisse*, Trennzeichen *Neue Zeilen*.
4. **Inhalte von URL abrufen**: URL `SPIEGEL_URL`, Methode **POST**, Header `Authorization` = `Bearer TOKEN`, Hauptteil **Datei** → *Kombinierter Text*.

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
