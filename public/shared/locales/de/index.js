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

// Module dictionaries first, so the core wording wins on duplicates.
export default { ...news, ...homeassistant, ...tasks, ...fuel, ...sky, ...football, ...schema, ...mirror, ...server, ...admin, ...auth };
