// German translations, keyed by the English source string.
import schema from './schema.js';
import mirror from './mirror.js';
import server from './server.js';
import admin from './admin.js';
import auth from './auth.js';
import news from './modules/news.js';
import homeassistant from './modules/homeassistant.js';
import tasks from './modules/tasks.js';
import fuel from './modules/fuel.js';
import sky from './modules/sky.js';
import football from './modules/football.js';
import flights from './modules/flights.js';
import calendar from './modules/calendar.js';
import countdown from './modules/countdown.js';
import parcels from './modules/parcels.js';
import airpollen from './modules/airpollen.js';
import bikes from './modules/bikes.js';
import nightsky from './modules/nightsky.js';
import pistatus from './modules/pistatus.js';
import network from './modules/network.js';
import github from './modules/github.js';
import f1 from './f1.js';
import transitClock from './transit-clock.js';
import layout from './layout.js';
import wasteService from './waste-service.js';

// Module dictionaries first, so the core wording wins on duplicates.
export default { ...github, ...countdown, ...parcels, ...airpollen, ...bikes, ...nightsky, ...pistatus, ...network, ...news, ...homeassistant, ...tasks, ...fuel, ...sky, ...football, ...calendar, ...flights, ...transitClock, ...layout, ...wasteService, ...f1, ...schema, ...mirror, ...server, ...admin, ...auth };
