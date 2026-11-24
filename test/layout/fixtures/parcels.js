// Parcels (src/providers/parcels.js): parcels in every state – out for delivery, in transit,
// announced, pickup, problem, delivered, unknown.
import { iso, addMin, addDays, LONG } from './index.js';

export default ({ now, long }) => {
  const base = { text: '', location: '', time: null, eta: null, deliveredAt: null, error: null };
  const list = [
    { ...base, name: 'Neue Winterschuhe', carrier: 'DHL', status: 'out', text: 'Die Sendung wurde in das Zustellfahrzeug geladen', location: 'Leipzig', time: iso(addMin(now, -95)), eta: { from: iso(addMin(now, 30)), to: iso(addMin(now, 150)) } },
    { ...base, name: 'Kaffeemaschine', carrier: 'Hermes', status: 'transit', text: 'Die Sendung ist im Verteilzentrum eingetroffen', location: 'Großbeeren', time: iso(addMin(now, -6 * 60)), eta: { from: iso(addDays(now, 1)), to: iso(addDays(now, 2)) } },
    { ...base, name: 'Buch für Mama', carrier: 'DPD', status: 'pre', text: 'Die Sendungsdaten wurden elektronisch übermittelt', location: '', time: iso(addMin(now, -26 * 60)), eta: { from: iso(addDays(now, 3)), to: iso(addMin(addDays(now, 3), 240)) } },
    { ...base, name: 'Ersatzteil Fahrrad', carrier: 'GLS', status: 'pickup', text: 'Die Sendung liegt im GLS PaketShop zur Abholung bereit', location: 'Leipzig, Karl-Liebknecht-Straße 54', time: iso(addMin(now, -3 * 60)) },
    { ...base, name: 'Rücksendung Jacke', carrier: 'DHL', status: 'exception', text: 'Zustellversuch erfolglos – Empfänger nicht angetroffen', location: 'Leipzig', time: iso(addMin(now, -20 * 60)), error: null },
    { ...base, name: 'Druckerpatronen', carrier: 'DHL', status: 'delivered', text: 'Die Sendung wurde erfolgreich zugestellt', location: 'Leipzig', time: iso(addDays(now, -1)), deliveredAt: iso(addDays(now, -1)) },
    { ...base, name: 'Geschenk Weihnachten', carrier: '', status: 'unknown', text: 'Noch nicht gefunden – der Paketdienst hat es evtl. noch nicht gescannt' },
  ];
  if (!long) return { parcels: list, total: list.length + 1, hidden: 1 };
  const carriers = ['DHL', 'Hermes', 'DPD', 'GLS', 'UPS', 'Deutsche Post DHL Group Paket International'];
  const statuses = ['transit', 'pre', 'out', 'pickup', 'exception', 'delivered', 'unknown'];
  const many = [];
  for (let i = 0; i < 15; i++) {
    const p = list[i % list.length];
    const status = statuses[i % statuses.length];
    many.push({
      ...p,
      status,
      name: i === 0 ? `${LONG} Weihnachtsgeschenk` : `${p.name} – Bestellung Nr. 30${4100 + i * 37} vom Onlineshop für Haushaltswaren`,
      carrier: carriers[i % carriers.length],
      text: `${p.text || 'Die Sendung wurde im Start-Paketzentrum bearbeitet'} und wird an das Ziel-Paketzentrum weitergeleitet`,
      location: 'Radefeld bei Schkeuditz, Paketzentrum Leipzig-Nord (Halle 4)',
      time: iso(addMin(now, -(i + 1) * 47)),
      eta: status === 'delivered' ? null : { from: iso(addMin(now, 60 + i * 30)), to: iso(addMin(now, 120 + i * 30)) },
      deliveredAt: status === 'delivered' ? iso(addMin(now, -120)) : null,
      error: i === 4 ? 'DHL-Fehler (HTTP 429): Zu viele Anfragen – nächster Versuch in 15 Minuten' : null,
    });
  }
  return { parcels: many, total: 15, hidden: 0 };
};
