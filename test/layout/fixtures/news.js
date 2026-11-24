// News (src/providers/news.js): { items: [{ title, source, date, description? }], errors }, newest first.
import { iso, addMin, LONG } from './index.js';

const HEADLINES = [
  ['MDR Sachsen', 'Leipzig: Neue Straßenbahnlinie nach Grünau soll 2028 fahren', 'Die Leipziger Verkehrsbetriebe stellen die Pläne für die Verlängerung vor. Baubeginn ist im kommenden Frühjahr.'],
  ['tagesschau.de', 'Bundestag beschließt Reform der Grundsteuer-Hebesätze', 'Kommunen sollen mehr Spielraum bei der Festlegung bekommen. Kritik kommt vom Städtetag.'],
  ['LVZ', 'Weihnachtsmarkt in der Innenstadt öffnet mit Rekordzahl an Ständen', 'Rund 300 Händler sind dabei, der Riesenrad-Standort wechselt auf den Augustusplatz.'],
  ['tagesschau.de', 'Deutsche Bahn: Pünktlichkeit im Fernverkehr leicht verbessert', 'Im Oktober waren knapp 67 Prozent der ICE und IC pünktlich.'],
  ['MDR Sachsen', 'RB Leipzig gewinnt Topspiel gegen Dortmund mit 3:1', 'Ein Doppelpack in der zweiten Halbzeit entschied die Partie vor ausverkauftem Haus.'],
  ['Spiegel', 'Wetterdienst warnt vor Glätte in Mitteldeutschland', 'Besonders in den Morgenstunden ist mit überfrierender Nässe zu rechnen.'],
  ['LVZ', 'Zoo Leipzig: Elefantennachwuchs im Tempel Ganesha Mandir', 'Das Jungtier ist wohlauf und ab dem Wochenende für Besucher zu sehen.'],
  ['tagesschau.de', 'Inflationsrate sinkt im November auf 1,9 Prozent', 'Vor allem Energie wurde günstiger, Lebensmittel blieben teurer als im Vorjahr.'],
];

export default ({ now, settings = {}, long }) => {
  const max = settings.maxItems || 6;
  const withDesc = !!settings.showDescription;
  const ages = [4, 23, 58, 95, 140, 210, 330, 520];
  let items;
  if (!long) {
    items = HEADLINES.slice(0, max).map(([source, title, description], i) => ({ title, source, date: iso(addMin(now, -ages[i % ages.length])), ...(withDesc ? { description } : {}) }));
  } else {
    items = Array.from({ length: max }, (_, i) => ({
      title: `${i % 2 ? LONG : 'Eilmeldung'}: Sächsischer Landtag debattiert in einer außerordentlichen Sondersitzung bis spät in die Nacht über das Haushaltsbegleitgesetz und die Finanzierung des öffentlichen Personennahverkehrs (${i + 1})`,
      source: i % 2 ? 'Mitteldeutscher Rundfunk – Nachrichten aus Sachsen, Sachsen-Anhalt und Thüringen' : 'Leipziger Volkszeitung Online',
      date: iso(addMin(now, -(i * 47 + 2))),
      ...(withDesc ? { description: `Nach stundenlanger Debatte und zahlreichen Änderungsanträgen der Opposition ${LONG} soll am Freitag abgestimmt werden …` } : {}),
    }));
  }
  return { items, errors: [] };
};
