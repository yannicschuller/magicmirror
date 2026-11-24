// Home Assistant: entity states as describe() in src/providers/homeassistant.js returns them.
import { iso, addMin, LONG } from './index.js';

const num = (id, label, icon, value, unit, decimals, changed, extra = {}) => ({
  id, label, icon, device_class: extra.device_class ?? null, domain: id.split('.')[0], raw: String(value), unit, changed: iso(changed),
  available: true, active: value !== 0, inactive: value === 0, value, decimals, ...extra,
});
const txt = (id, label, icon, raw, state, changed, { active = false, inactive = false, device_class = null } = {}) => ({
  id, label, icon, device_class, domain: id.split('.')[0], raw, unit: '', changed: iso(changed), available: true, active, inactive, state,
});

export default ({ now, long }) => {
  const ago = (m) => addMin(now, -m);
  const entities = [
    num('sensor.wohnzimmer_temperatur', 'Wohnzimmer', 'thermometer', 21.4, '°C', 1, ago(12), { device_class: 'temperature' }),
    num('sensor.schlafzimmer_temperatur', 'Schlafzimmer', 'thermometer', 18.9, '°C', 1, ago(25), { device_class: 'temperature' }),
    num('sensor.bad_luftfeuchtigkeit', 'Bad Luftfeuchte', 'humidity', 67, '%', 0, ago(4), { device_class: 'humidity', warn: true }),
    txt('binary_sensor.kuechenfenster', 'Küchenfenster', 'window', 'on', 'Offen', ago(18), { active: true, device_class: 'window' }),
    txt('binary_sensor.haustuer', 'Haustür', 'door', 'off', 'Geschlossen', ago(95), { inactive: true, device_class: 'door' }),
    num('sensor.hausverbrauch', 'Verbrauch', 'bolt', 1240, 'W', 0, ago(1), { device_class: 'power' }),
    txt('lock.wohnungstuer', 'Wohnungstür', 'lock', 'locked', 'Verriegelt', ago(140)),
    txt('sensor.waschmaschine_status', 'Waschmaschine', 'plug', 'Fertig', 'Fertig', ago(7)),
  ];
  if (long) {
    entities.push(
      num('sensor.photovoltaik_leistung', 'Photovoltaikanlage Garagendach Südseite', 'sun', 123456.7, 'W', 1, ago(2), { device_class: 'power' }),
      txt('light.wohnzimmer_stehlampe', `${LONG} Stehlampe`, 'light', 'on', 'An', ago(33), { active: true }),
      num('sensor.e_auto_akku', 'Akkustand Elektroauto (Wallbox Carport)', 'battery', 87, '%', 0, ago(48), { device_class: 'battery' }),
      { id: 'sensor.keller_feuchte', label: 'Kellerraum hinten links (Waschküche)', icon: 'humidity', device_class: 'humidity', domain: 'sensor', raw: 'unavailable', unit: '', changed: iso(ago(600)), available: false, active: false, inactive: false, state: 'Nicht verfügbar' },
      { id: 'sensor.dachboden_temperatur', label: 'sensor.dachboden_temperatur', icon: 'generic', state: 'Nicht gefunden', raw: null, missing: true, active: false, inactive: false },
      num('sensor.strom_jahresverbrauch', 'Stromverbrauch seit Jahresbeginn', 'bolt', 98765.43, 'kWh', 1, ago(3), { device_class: 'energy' }),
    );
  }
  return { entities, configured: entities.length, live: true };
};
