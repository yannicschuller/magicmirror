// Public transport (src/providers/transit.js): LVB departure board for Leipzig, Augustusplatz.
import { iso, addMin, LONG } from './index.js';

const LINES = [
  ['4', 'tram', 'Straßenbahn', 'Stötteritz', 'Leipzig-Gohlis, Landsberger Straße über Hauptbahnhof und Waldplatz'],
  ['7', 'tram', 'Straßenbahn', 'Böhlitz-Ehrenberg', 'Sommerfeld über Paunsdorf-Center, Riesaer Straße und Hans-Weigel-Straße'],
  ['12', 'tram', 'Straßenbahn', 'Gohlis-Nord', 'Johannisplatz über Hauptbahnhof, Westseite und Goerdelerring'],
  ['15', 'tram', 'Straßenbahn', 'Meusdorf', 'Miltitz über Lindenau, Henriettenstraße und Lausen-Grünau, Ratzelbogen'],
  ['16', 'tram', 'Straßenbahn', 'Lößnig', 'Messegelände über Wilhelm-Leuschner-Platz, Zentralstadion und Wiederitzsch'],
  ['8', 'tram', 'Straßenbahn', 'Paunsdorf, Strasse am Park', 'Grünau-Nord über Lindenau und Plovdiver Straße'],
  ['10', 'tram', 'Straßenbahn', 'Lößnig', 'Wahren über Hauptbahnhof, Gohlis-Süd und Möckern'],
  ['11', 'tram', 'Straßenbahn', 'Markkleeberg-Ost', 'Schkeuditz über Wahren, Lützschena und Hänichen'],
  ['89', 'bus', 'Bus', 'Connewitz, Kreuz', 'Leipzig, Hauptbahnhof Ostseite über Johannisplatz und Augustusplatz'],
  ['S3', 'sbahn', 'S-Bahn', 'Halle (Saale) Hbf', 'Halle-Trotha über Leipzig Hbf (tief), Flughafen Leipzig/Halle und Halle (Saale) Hbf'],
  ['RE13', 'train', 'Regional-Express', 'Magdeburg Hbf', 'Magdeburg Hauptbahnhof über Bitterfeld, Dessau Hbf und Roßlau (Elbe)'],
];

export default ({ now, settings, long }) => {
  const limit = long ? 30 : Number(settings.limit) || 8;
  const departures = [];
  for (let i = 0; i < limit; i++) {
    const [line, category, product, dest, longDest] = LINES[i % LINES.length];
    const planned = addMin(now, 1 + i * (long ? 2 : 3) + (i % 2));
    // a mix of punctual, late, early-reported and cancelled departures
    const delay = i % 5 === 1 ? 3 : i % 5 === 3 ? 1 : i % 7 === 4 ? 12 : i % 4 === 2 ? 0 : null;
    departures.push({
      line,
      category,
      product,
      destination: long ? (i === 2 ? `${LONG} ${longDest}` : longDest) : dest,
      planned: iso(planned),
      realtime: delay === null ? null : iso(addMin(planned, delay)),
      platform: category === 'sbahn' || category === 'train' ? `Gleis ${1 + (i % 2)}` : `Steig ${String.fromCharCode(65 + (i % 4))}`,
      cancelled: i === 5,
    });
  }
  const out = { stop: long ? 'Leipzig, Augustusplatz (Opernhaus / Gewandhaus / Universität)' : 'Leipzig, Augustusplatz', departures };
  if (settings.showDisruptions !== false) {
    const all = [
      { id: 'lvb-1', title: 'Gleisbauarbeiten in der Karl-Liebknecht-Straße – Umleitung der Linie 11', text: 'Vom 24.11. bis voraussichtlich 12.12. fahren die Straßenbahnen der Linie 11 zwischen Hauptbahnhof und Connewitz, Kreuz eine Umleitung über Bayerischer Platz. Ersatzhaltestellen sind ausgeschildert.', priority: 'high', lines: [{ line: '11', category: 'tram' }] },
      { id: 'lvb-2', title: 'Haltestelle Augustusplatz: Steig C verlegt', text: 'Wegen einer Veranstaltung auf dem Augustusplatz halten die Linien 4, 7 und 12 an der Ersatzhaltestelle vor dem Gewandhaus.', priority: 'normal', lines: [{ line: '4', category: 'tram' }, { line: '7', category: 'tram' }, { line: '12', category: 'tram' }] },
      { id: 'sbahn-3', title: `S3: Schienenersatzverkehr zwischen Leipzig-Wahren und Schkeuditz ${LONG}`, text: 'Wegen Bauarbeiten am Stellwerk fahren Ersatzbusse mit etwa 25 Minuten längerer Fahrzeit.', priority: 'normal', lines: [{ line: 'S3', category: 'sbahn' }] },
      { id: 'lvb-4', title: 'Linie 89: Verspätungen wegen hohen Verkehrsaufkommens in der Innenstadt', text: 'Bitte planen Sie etwas mehr Zeit ein.', priority: 'normal', lines: [{ line: '89', category: 'bus' }] },
      { id: 'lvb-5', title: 'Weihnachtsmarkt: geänderte Haltestellen für die Linien 8, 10, 15 und 16 bis Jahresende', text: 'Die Haltestellen am Wilhelm-Leuschner-Platz werden in die Grünewaldstraße verlegt.', priority: 'normal', lines: [{ line: '8', category: 'tram' }, { line: '10', category: 'tram' }, { line: '15', category: 'tram' }, { line: '16', category: 'tram' }] },
      { id: 'db-6', title: 'RE13: Zugausfälle zwischen Bitterfeld und Dessau wegen Personalmangel', text: 'Einzelne Fahrten entfallen. Nutzen Sie bitte die S-Bahn-Linie S8.', priority: 'high', lines: [{ line: 'RE13', category: 'train' }] },
    ];
    const max = long ? 6 : Math.max(1, Number(settings.disruptionsMax) || 2);
    const list = (long ? all : all.filter((x) => x.id !== 'sbahn-3')).sort((a, b) => (b.priority === 'high') - (a.priority === 'high')).slice(0, max);
    if (list.length) out.disruptions = list;
  }
  return out;
};
