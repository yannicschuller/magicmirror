# Apple Reminders on the mirror

Apple does not offer an API for Reminders, and lists created since iOS 13 no longer sync via CalDAV. Instead, an **Apple Shortcuts automation** on your iPhone, iPad or Mac sends the open reminders to the mirror. The *Tasks & shopping list* module then shows the last state it received.

[Deutsche Anleitung](apple-reminders.de.md)

## 1. Set up the module

1. In the admin panel, add a *Tasks & shopping list* module (or use the existing one).
2. Set the **source** to *Apple Reminders (Shortcuts)*.
3. Copy the **token** shown below it. It is generated automatically; it acts as the password for the Shortcut.
4. Save.

## 2. Create the Shortcut

In the **Shortcuts** app, create a new shortcut, e.g. "Reminders → Mirror", with these actions:

1. **Find Reminders**
   - Filter: *Is Completed* is *off*
   - Optional: *List* is *Shopping* (otherwise all lists)
   - Sort by *Due Date*, Limit off
2. **Repeat with Each** (input: *Reminders*). Inside the loop, add one **Text** action:
   ```
   [Repeat Item › Title] | [Repeat Item › Due Date] | [Repeat Item › Priority]
   ```
   Insert the variables by tapping *Repeat Item* and choosing the property. For the due date, tap the variable again and set **Date Format → ISO 8601**.
3. After *End Repeat*, add **Combine Text**: input *Repeat Results*, separator *New Lines*.
4. **Get Contents of URL**
   - URL: `http://mirror.local:8080/api/push/tasks` (your mirror's address)
   - Method: **POST**
   - Headers: `Authorization` = `Bearer YOUR_TOKEN`
   - Request Body: **File** → *Combined Text*

Run it once with ▶. The response should be `{"ok":true,"received":…}` and the module on the mirror updates immediately.

> **Simple variant:** if you only need the titles, skip steps 2–3 and use **Combine Text** directly on the found reminders (each reminder becomes its title).

## 3. Run it automatically

In the Shortcuts app → **Automation** → **+** → *Create Personal Automation*:

- **App** → *Reminders* → *Is Closed* – sends the list every time you leave the Reminders app (recommended).
- Optionally also **Time of Day**, e.g. daily at 6:00, so the mirror is up to date in the morning.

Choose **Run Immediately** and turn off *Notify When Run*. Select your shortcut as the action.

## Good to know

- The phone has to reach the mirror. In your home Wi-Fi that works out of the box. From outside, it only works via VPN or if the mirror is reachable through a reverse proxy (then use the `https://` address).
- The mirror keeps the last list it received, also across restarts (`data/push/`). If no update arrives for longer than the configured number of hours, the module shows a small "Last update" note.
- Line format the endpoint understands: `title | due | priority`. Due date as `2026-10-28` (all-day) or ISO 8601 with time. Priority as *High/Medium/Low* (also German *Hoch/Mittel/Niedrig*) or Apple's numbers 1–9. JSON (`["Milk", …]` or `{"items":[{"title":…,"due":…}]}`) works as well.
- Test from a computer:
  ```bash
  curl -X POST -H "Authorization: Bearer YOUR_TOKEN" --data-binary $'Milk\nBread | 2026-10-28' http://mirror.local:8080/api/push/tasks
  ```
- Creating a new token in the admin panel locks out old shortcuts.
