// Plug-in module schemas. Each file exports { type, label, description,
// defaultRegion, defaultTitle, refresh, fields } – see CONTRIBUTING.md.
import news from './news.js';
import homeassistant from './homeassistant.js';
import tasks from './tasks.js';
import fuel from './fuel.js';
import sky from './sky.js';
import football from './football.js';
import calendar from './calendar.js';

export default [news, homeassistant, tasks, fuel, sky, football, calendar];
