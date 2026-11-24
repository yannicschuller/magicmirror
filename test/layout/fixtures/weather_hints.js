// Weather hints (src/providers/weather.js → weatherHints()): { hints: [{ kind, level, title, detail }] },
// sorted severe → warn → info. German texts as the provider's translator produces them.
import { LONG } from './index.js';

const TZ = 'Europe/Berlin';
const hourOf = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
const dayOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

export default ({ now, long }) => {
  // "15 Uhr" today, "morgen 6 Uhr" tomorrow – like the provider's at()
  const at = (hoursAhead) => {
    const d = new Date(now.getTime() + hoursAhead * 3600000);
    const label = `${hourOf(d)} Uhr`;
    return dayOf(d) === dayOf(now) ? label : `morgen ${label}`;
  };
  if (!long) {
    return {
      hints: [
        { kind: 'wind', level: 'warn', title: 'Stürmisch – lose Gegenstände sichern', detail: `Böen bis 68 km/h ${at(5)}` },
        { kind: 'rain', level: 'info', title: 'Regenschirm nicht vergessen!', detail: `Regen ab ${at(1)} · bis 80 % · ca. 3,4 mm` },
        { kind: 'frost', level: 'info', title: 'Frost – Vorsicht Glätte & Scheibe kratzen', detail: `Tiefstwert −2 °C ${at(9)}` },
      ],
    };
  }
  return {
    hints: [
      { kind: 'dwd', level: 'severe', title: 'Amtliche UNWETTERWARNUNG vor ORKANBÖEN, EXTREM ERGIEBIGEM DAUERREGEN und STARKEM SCHNEEFALL für die Stadt Leipzig und den Landkreis Nordsachsen', detail: 'DWD · Extremes Unwetter durch Orkanböen und Dauerregen mit Schneeverwehungen' },
      { kind: 'wind', level: 'severe', title: 'Stürmisch – lose Gegenstände sichern', detail: `Böen bis 154 km/h ${at(3)}` },
      { kind: 'dwd', level: 'warn', title: 'Amtliche WARNUNG vor GLATTEIS und überfrierender Nässe im gesamten Stadtgebiet', detail: `DWD · Glatteis – ${LONG}` },
      { kind: 'thunder', level: 'warn', title: 'Regenschirm nicht vergessen!', detail: `Regen schon jetzt · bis 100 % · ca. 148,6 mm · Gewitter möglich` },
      { kind: 'snow', level: 'warn', title: 'Schnee erwartet – warm anziehen!', detail: `ab ${at(2)}` },
      { kind: 'frost', level: 'warn', title: 'Frost – Vorsicht Glätte & Scheibe kratzen', detail: `Tiefstwert −24 °C ${at(11)}` },
      { kind: 'uv', level: 'warn', title: 'Eincremen nicht vergessen!', detail: `UV-Index 11 (extrem) gegen ${at(4)}` },
      { kind: 'heat', level: 'info', title: 'Heiß – viel trinken!', detail: `bis 38 °C ${at(7)}` },
    ],
  };
};
