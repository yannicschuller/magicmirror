# Apple Reminders on the mirror

Apple offers no Reminders API, and lists created since iOS 13 no longer sync via CalDAV. Instead, a **Shortcut** on your iPhone, iPad or Mac sends the open reminders to the mirror. The *Tasks & shopping list* module then shows the last state it received.

[Deutsche Anleitung](apple-reminders.de.md)

## 1. Set up the module

1. Admin panel → *Modules* → add *Tasks & shopping list* (or open the existing one).
2. **Source:** *Apple Reminders (Shortcuts)*.
3. Copy the **token** shown below it. It is generated automatically and acts as the password for the Shortcut.
4. Save.

You'll need three values:

| Placeholder | Example |
|---|---|
| `MIRROR_URL` | `http://mirror.local:8080/api/push/tasks` (your mirror's address + `/api/push/tasks`) |
| `TOKEN` | the token from step 3 |
| `LIST` | the name of your reminders list, e.g. `Groceries` – or `all` |

## 2. Let AI build the Shortcut

Shortcuts can now be created from a plain description, for example with Apple Intelligence in the Shortcuts app or with an AI assistant that walks you through the actions. Replace the three placeholders and use this prompt:

```text
Create a shortcut named "Reminders → Mirror":

1. Find all reminders that are NOT completed from the list "LIST"
   (if "all": from all lists), sorted by due date.
2. Repeat with each reminder found: create a text in the format
   Title | Due Date | Priority
   – due date formatted as ISO 8601 (empty if none is set),
   – priority as None/Low/Medium/High.
3. Combine the repeat results into one text, separated by new lines.
4. Send this text with "Get Contents of URL" to MIRROR_URL:
   method POST, header "Authorization" with the value "Bearer TOKEN",
   request body: File = the combined text.

Also create two personal automations that run this shortcut immediately,
without asking and without a notification:
a) when the "Reminders" app is closed,
b) every day at 6:00.
```

Then run the shortcut once with ▶. The response should be `{"ok":true,"received":…}` and the module on the mirror updates immediately.

> **Tip:** take a quick look at the generated actions – AI assistants sometimes swap header name and value or forget the date format. The correct setup is described below.

## 3. Manually (if the AI doesn't help)

In the **Shortcuts** app, create a shortcut with these actions:

1. **Find Reminders**: filter *Is Completed* is *off*, optionally *List* is *Groceries*, sort by *Due Date*.
2. **Repeat with Each** (input: *Reminders*) containing one **Text** action:
   ```
   [Repeat Item › Title] | [Repeat Item › Due Date] | [Repeat Item › Priority]
   ```
   Tap the due-date variable and set **Date Format → ISO 8601**.
3. After *End Repeat*: **Combine Text** – *Repeat Results*, separator *New Lines*.
4. **Get Contents of URL**: URL `MIRROR_URL`, method **POST**, header `Authorization` = `Bearer TOKEN`, request body **File** → *Combined Text*.

**Automation:** Shortcuts → **Automation** → **+** → *App* → *Reminders* → *Is Closed* (optionally also *Time of Day* 6:00) → **Run Immediately**, *Notify When Run* off → pick your shortcut.

> **Simplest variant:** if titles are enough, skip the repeat and use **Combine Text** directly on the found reminders.

## Good to know

- The phone has to reach the mirror: in your home Wi-Fi that just works; from outside only via VPN or a reverse proxy with `https://`.
- The mirror keeps the last list it received, also across restarts. If no update arrives for longer than configured, the module shows a small "Last update" note.
- Formats the endpoint understands:
  - lines: `title | due | priority` – due as `2026-10-28` (all-day) or ISO 8601 with time, priority as High/Medium/Low (also German) or Apple's numbers 1–9;
  - JSON: `["Milk", …]` or `{"items":[{"title":…,"due":…}]}`.
- Test from a computer:
  ```bash
  curl -X POST -H "Authorization: Bearer TOKEN" --data-binary $'Milk\nBread | 2026-10-28' MIRROR_URL
  ```
- Creating a new token in the admin panel locks out old shortcuts.
