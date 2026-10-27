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

The Shortcuts app can build a shortcut from a short description. It prefers **short, simple sentences** – long descriptions get "Try a different description". Replace the three placeholders and try the simple version first:

**Simple (titles only):**

```text
Find all incomplete reminders in the list LIST, combine their titles with new lines and send the text via POST to MIRROR_URL with the header Authorization: Bearer TOKEN.
```

**With due dates** (if the simple version works and you want dates):

```text
Find all incomplete reminders in the list LIST. For each, make a line with Title | due date in ISO 8601 format. Combine the lines with new lines and send the text via POST to MIRROR_URL with the header Authorization: Bearer TOKEN.
```

Then run the shortcut once with ▶. The response should be `{"ok":true,"received":…}` and the module on the mirror updates immediately.

> **If it doesn't work:** if you keep getting "Try a different description", or the generated actions are wrong (typically: header name and value swapped, body not sent as text/file), build it with the four actions in section 4 – it takes about two minutes.

## 3. Set up the automation (always manual)

The AI can't create automations. Do it by hand:

Shortcuts → **Automation** → **+**:

1. **App** → *Reminders* → *Is Closed* → **Run Immediately**, *Notify When Run* off → pick your shortcut. The list is now sent every time you leave the Reminders app.
2. Optionally also **Time of Day** → daily 6:00 → same settings, so the mirror is up to date in the morning.

## 4. Build the shortcut manually

In the **Shortcuts** app, create a shortcut with these actions:

1. **Find Reminders**: filter *Is Completed* is *off*, optionally *List* is *Groceries*, sort by *Due Date*.
2. **Repeat with Each** (input: *Reminders*) containing one **Text** action:
   ```
   [Repeat Item › Title] | [Repeat Item › Due Date] | [Repeat Item › Priority]
   ```
   Tap the due-date variable and set **Date Format → ISO 8601**.
3. After *End Repeat*: **Combine Text** – *Repeat Results*, separator *New Lines*.
4. **Get Contents of URL**: URL `MIRROR_URL`, method **POST**, header `Authorization` = `Bearer TOKEN`, request body **File** → *Combined Text*.

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
