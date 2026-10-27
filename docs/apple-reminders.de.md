# Apple Erinnerungen auf dem Spiegel

Apple bietet keine Schnittstelle für die Erinnerungen, und seit iOS 13 erstellte Listen werden nicht mehr per CalDAV synchronisiert. Stattdessen schickt eine **Kurzbefehle-Automation** auf iPhone, iPad oder Mac die offenen Erinnerungen an den Spiegel. Das Modul *Aufgaben & Einkaufsliste* zeigt dann den zuletzt empfangenen Stand.

[English guide](apple-reminders.md)

## 1. Modul einrichten

1. Im Admin-Panel ein Modul *Aufgaben & Einkaufsliste* anlegen (oder das vorhandene nehmen).
2. **Quelle** auf *Apple Erinnerungen (Kurzbefehle)* stellen.
3. Den darunter angezeigten **Token** kopieren. Er wird automatisch erzeugt und ist das Passwort für den Kurzbefehl.
4. Speichern.

## 2. Kurzbefehl erstellen

In der App **Kurzbefehle** einen neuen Kurzbefehl anlegen, z. B. „Erinnerungen → Spiegel“, mit diesen Aktionen:

1. **Erinnerungen suchen**
   - Filter: *Ist erledigt* ist *nicht aktiviert*
   - Optional: *Liste* ist *Einkauf* (sonst alle Listen)
   - Sortieren nach *Fälligkeitsdatum*, Limit aus
2. **Wiederholen mit jedem Objekt** (Eingabe: *Erinnerungen*). In die Schleife eine Aktion **Text** einfügen:
   ```
   [Wiederholungsobjekt › Titel] | [Wiederholungsobjekt › Fälligkeitsdatum] | [Wiederholungsobjekt › Priorität]
   ```
   Die Variablen fügst du ein, indem du auf *Wiederholungsobjekt* tippst und die Eigenschaft wählst. Beim Fälligkeitsdatum die Variable noch einmal antippen und **Datumsformat → ISO 8601** einstellen.
3. Nach *Wiederholung beenden*: **Text kombinieren**, Eingabe *Wiederholungsergebnisse*, Trennzeichen *Neue Zeilen*.
4. **Inhalte von URL abrufen**
   - URL: `http://mirror.local:8080/api/push/tasks` (Adresse deines Spiegels)
   - Methode: **POST**
   - Header: `Authorization` = `Bearer DEIN_TOKEN`
   - Hauptteil der Anfrage: **Datei** → *Kombinierter Text*

Einmal mit ▶ ausführen. Als Antwort kommt `{"ok":true,"received":…}`, und das Modul auf dem Spiegel aktualisiert sich sofort.

> **Einfache Variante:** Wenn dir die Titel reichen, lass Schritt 2 und 3 weg und kombiniere direkt die gefundenen Erinnerungen per **Text kombinieren** (jede Erinnerung wird zu ihrem Titel).

## 3. Automatisch ausführen

Kurzbefehle → **Automation** → **+** → *Persönliche Automation erstellen*:

- **App** → *Erinnerungen* → *Wird geschlossen*: schickt die Liste jedes Mal, wenn du die Erinnerungen-App verlässt (empfohlen).
- Optional zusätzlich **Tageszeit**, z. B. täglich um 6:00, damit der Spiegel morgens aktuell ist.

**Sofort ausführen** wählen und *Bei Ausführung benachrichtigen* ausschalten. Als Aktion deinen Kurzbefehl auswählen.

## Gut zu wissen

- Das Handy muss den Spiegel erreichen. Im eigenen WLAN klappt das direkt. Unterwegs nur per VPN oder wenn der Spiegel über einen Reverse-Proxy erreichbar ist (dann die `https://`-Adresse nehmen).
- Der Spiegel merkt sich die zuletzt empfangene Liste, auch über Neustarts (`data/push/`). Kommt länger als die eingestellte Stundenzahl nichts Neues, zeigt das Modul klein „Stand: …“.
- Zeilenformat, das der Endpunkt versteht: `Titel | Fällig | Priorität`. Fälligkeit als `2026-10-28` (ganztägig) oder ISO 8601 mit Uhrzeit, Priorität als *Hoch/Mittel/Niedrig* oder Apples Zahlen 1–9. JSON (`["Milch", …]` oder `{"items":[{"title":…,"due":…}]}`) geht auch.
- Test vom Rechner aus:
  ```bash
  curl -X POST -H "Authorization: Bearer DEIN_TOKEN" --data-binary $'Milch\nBrot | 2026-10-28' http://mirror.local:8080/api/push/tasks
  ```
- Ein neuer Token im Admin-Panel sperrt alte Kurzbefehle aus.
