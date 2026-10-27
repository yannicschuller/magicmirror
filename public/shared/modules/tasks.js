// Tasks & shopping list – open to-dos from Todoist, a Home Assistant to-do
// entity or a CalDAV task list (Nextcloud, iCloud, …).

export default {
  type: 'tasks',
  label: 'Tasks & shopping list',
  description: 'Open to-dos from Todoist, Home Assistant or CalDAV (Nextcloud, iCloud, …)',
  defaultRegion: 'middle_right',
  defaultTitle: 'To-dos',
  refresh: 120,
  fields: [
    { key: 'source', label: 'Source', type: 'select', default: 'todoist', options: [
      { value: 'todoist', label: 'Todoist' },
      { value: 'homeassistant', label: 'Home Assistant to-do list' },
      { value: 'caldav', label: 'CalDAV (Nextcloud, iCloud, …)' },
    ] },

    { key: 'todoistToken', label: 'Todoist API token (Settings → Integrations → Developer)', type: 'text', default: '', secret: true, showIf: { source: 'todoist' } },
    { key: 'todoistProject', label: 'Only this project (name or ID, empty = all)', type: 'text', default: '', placeholder: 'Einkauf', showIf: { source: 'todoist' } },
    { key: 'todoistFilter', label: 'Todoist filter (optional)', type: 'text', default: '', placeholder: 'today | overdue', showIf: { source: 'todoist' } },

    { key: 'haUrl', label: 'Home Assistant URL', type: 'text', default: '', secret: true, placeholder: 'http://homeassistant.local:8123', showIf: { source: 'homeassistant' } },
    { key: 'haToken', label: 'Long-lived access token', type: 'text', default: '', secret: true, showIf: { source: 'homeassistant' } },
    { key: 'haEntity', label: 'To-do entity', type: 'text', default: 'todo.shopping_list', placeholder: 'todo.shopping_list', showIf: { source: 'homeassistant' } },

    { key: 'caldavUrl', label: 'URL of the task list', type: 'text', default: '', secret: true, placeholder: 'https://cloud.example.com/remote.php/dav/calendars/user/tasks/', showIf: { source: 'caldav' } },
    { key: 'caldavUser', label: 'Username', type: 'text', default: '', secret: true, showIf: { source: 'caldav' } },
    { key: 'caldavPassword', label: 'Password (app password)', type: 'text', default: '', secret: true, showIf: { source: 'caldav' } },

    { key: 'maxItems', label: 'Max. entries', type: 'number', default: 10, min: 1, max: 50 },
    { key: 'sort', label: 'Sort order', type: 'select', default: 'due', options: [
      { value: 'due', label: 'By due date' },
      { value: 'priority', label: 'By priority' },
      { value: 'source', label: 'As in the source' },
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
