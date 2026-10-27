// Tiny gettext-style i18n shared by server, mirror and admin panel.
// English source strings are the message ids; other languages map them.
import de from './locales/de/index.js';

const DICTS = { de };

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

export function langOf(locale) {
  const l = String(locale || '').slice(0, 2).toLowerCase();
  return DICTS[l] ? l : 'en';
}

// t('Hello {name}', { name }) – unknown ids fall back to the id itself.
export function translator(lang) {
  const dict = DICTS[lang] || {};
  return (id, params) => {
    if (id === undefined || id === null || id === '') return id;
    let out = dict[id] ?? id;
    if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
    return out;
  };
}
