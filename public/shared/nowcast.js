// Rain in the next two hours from 15-minute precipitation steps (Open-Meteo minutely_15,
// in Germany from the DWD ICON-D2 model). Shared by the weather renderer and the tests.

export const WET_MM = 0.1; // per 15 minutes – below that it is dry

// steps: [{ time: "YYYY-MM-DDTHH:MM" (local), mm }] starting with the current quarter hour
// → { kind: 'none' | 'starts' | 'stops' | 'continues', at, intensity, peak }
export function rainSummary(steps) {
  if (!steps?.length) return { kind: 'none' };
  const wet = steps.map((s) => (s.mm ?? 0) >= WET_MM);
  const peak = Math.max(...steps.map((s) => s.mm ?? 0));
  const perHour = peak * 4;
  const intensity = perHour >= 7.6 ? 'heavy' : perHour >= 2.5 ? 'moderate' : 'light';
  if (wet[0]) {
    const stop = wet.indexOf(false);
    return stop < 0 ? { kind: 'continues', intensity, peak } : { kind: 'stops', at: steps[stop].time, intensity, peak };
  }
  const start = wet.indexOf(true);
  return start < 0 ? { kind: 'none', peak } : { kind: 'starts', at: steps[start].time, intensity, peak };
}
