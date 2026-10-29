// Tasks & shopping list – open to-dos from Todoist, a Home Assistant to-do
// entity, a CalDAV task list (Nextcloud, …) or Apple Reminders pushed by an
// Apple Shortcuts automation (POST /api/push/tasks, see README).

// Random token for the push endpoint (browser and Node 22 both have crypto.getRandomValues).
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

export default {
  type: 'tasks',
  label: 'Tasks & shopping list',
  description: 'Open to-dos from Todoist, Home Assistant, CalDAV (Nextcloud, …) or Apple Reminders',
  defaultRegion: 'middle_right',
  defaultTitle: 'To-dos',
  refresh: 120,
  fields: [
    { key: 'source', label: 'Source', type: 'select', default: 'todoist', options: [
      { value: 'todoist', label: 'Todoist' },
      { value: 'homeassistant', label: 'Home Assistant to-do list' },
      { value: 'caldav', label: 'CalDAV (Nextcloud, iCloud, …)' },
      { value: 'shortcuts', label: 'Apple Reminders (Shortcuts)' },
    ] },

    { key: 'pushToken', label: 'Token for the Shortcut', type: 'text', default: randomToken, secret: true, showIf: { source: 'shortcuts' },
      help: 'Your Shortcut sends the open reminders to <mirror address>/api/push/tasks with the header "Authorization: Bearer <this token>". Step-by-step guide: README → Apple Reminders. Changing the token locks out old Shortcuts.' },
    { key: 'shortcutSetup', label: 'Values for the Shortcut', type: 'shortcutSetup', default: '', showIf: { source: 'shortcuts' } },
    { key: 'staleHours', label: 'Show a note if no update for (hours, 0 = never)', type: 'number', default: 24, min: 0, max: 720, showIf: { source: 'shortcuts' } },

    { key: 'todoistToken', label: 'Todoist API token (Settings → Integrations → Developer)', type: 'text', default: '', secret: true, showIf: { source: 'todoist' } },
    { key: 'todoistProject', label: 'Only this project (name or ID, empty = all)', type: 'text', default: '', placeholder: 'Einkauf', showIf: { source: 'todoist' } },
    { key: 'todoistFilter', label: 'Todoist filter (optional)', type: 'text', default: '', placeholder: 'today | overdue', showIf: { source: 'todoist' } },

    { key: 'haUrl', label: 'Home Assistant URL', type: 'text', default: '', secret: true, placeholder: 'http://homeassistant.local:8123', showIf: { source: 'homeassistant' } },
    { key: 'haToken', label: 'Long-lived access token', type: 'text', default: '', secret: true, showIf: { source: 'homeassistant' } },
    { key: 'haEntity', label: 'To-do entity', type: 'text', default: 'todo.shopping_list', placeholder: 'todo.shopping_list', showIf: { source: 'homeassistant' } },

    { key: 'caldavUrl', label: 'URL of the task list', type: 'text', default: '', secret: true, placeholder: 'https://cloud.example.com/remote.php/dav/calendars/user/tasks/', showIf: { source: 'caldav' } },
    { key: 'caldavUser', label: 'Username', type: 'text', default: '', secret: true, showIf: { source: 'caldav' } },
    { key: 'caldavPassword', label: 'Password (app password)', type: 'text', default: '', secret: true, showIf: { source: 'caldav' } },

    { key: 'dueWithinDays', label: 'Only tasks due within the next … days (0 = all)', type: 'number', default: 0, min: 0, max: 365,
      help: '1 = today and tomorrow. Overdue tasks are always included.' },
    { key: 'includeNoDue', label: 'Also show tasks without a due date', type: 'bool', default: true,
      help: 'Only matters when the due filter above is on – e.g. turn off to hide shopping list items.' },
    { key: 'maxItems', label: 'Max. entries', type: 'number', default: 10, min: 1, max: 50 },
    { key: 'sort', label: 'Sort order', type: 'select', default: 'due', options: [
      { value: 'due', label: 'By due date' },
      { value: 'priority', label: 'By priority' },
      { value: 'source', label: 'As in the source' },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List (one below the other)' },
      { value: 'columns', label: 'Columns (side by side, as many as fit)' },
      { value: 'inline', label: 'Flowing (one after another, line by line)' },
    ] },
    { key: 'listStyle', label: 'List style', type: 'select', default: 'checkbox', options: [
      { value: 'checkbox', label: 'Checkboxes' },
      { value: 'bullet', label: 'Bullets' },
      { value: 'plain', label: 'Text only' },
    ] },
    { key: 'showDue', label: 'Show due date', type: 'bool', default: true },
    { key: 'highlightOverdue', label: 'Highlight overdue tasks', type: 'bool', default: true },
    { key: 'showPriority', label: 'Mark high priority', type: 'bool', default: true },
    { key: 'showCount', label: 'Show number of further tasks', type: 'bool', default: true },
  ],
};
