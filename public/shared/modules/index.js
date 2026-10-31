// Plug-in module schemas. Each file exports { type, label, description,
// defaultRegion, defaultTitle, refresh, fields } – see CONTRIBUTING.md.
import news from './news.js';
import homeassistant from './homeassistant.js';
import tasks from './tasks.js';
import fuel from './fuel.js';
import sky from './sky.js';
import football from './football.js';
import calendar from './calendar.js';
import countdown from './countdown.js';
import parcels from './parcels.js';
import airpollen from './airpollen.js';
import bikes from './bikes.js';
import nightsky from './nightsky.js';
import pistatus from './pistatus.js';
import network from './network.js';
import github from './github.js';

export default [news, homeassistant, tasks, fuel, sky, football, calendar, countdown, parcels, airpollen, bikes, nightsky, pistatus, network, github];
