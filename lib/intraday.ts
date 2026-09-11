// Intraday samples recorded from each snapshot (≥10 min apart, 8 days kept) — powers 1-day / 1-week charts
// for rial assets and the TSE index, which have no free intraday source.
import { kv } from '@/lib/store';
import { isNum } from '@/lib/num';
import type { AssetKey } from '@/lib/types';

const KEY = 'hist:intraday:v1';
const KEEP_MS = 8 * 86400_000;
const MIN_GAP_MS = 10 * 60_000;
const KEYS: AssetKey[] = ['usd', 'usdt', 'g18', 'coin', 'ons', 'btc', 'eth', 'tse'];

export interface IntradayStore {
  t: number[];
  v: Record<AssetKey, (number | null)[]>;
}

const empty = (): IntradayStore => ({ t: [], v: Object.fromEntries(KEYS.map((k) => [k, []])) as unknown as IntradayStore['v'] });

export async function loadIntraday(): Promise<IntradayStore> {
  const s = await kv.get<IntradayStore>(KEY);
  if (!s?.t) return empty();
  for (const k of KEYS) if (!Array.isArray(s.v[k])) s.v[k] = s.t.map(() => null);
  return s;
}

/** Appends a sample if the last one is older than 10 minutes. Returns true when stored. */
export async function recordIntraday(at: number, point: Partial<Record<AssetKey, number | null>>): Promise<boolean> {
  const s = await loadIntraday();
  const last = s.t[s.t.length - 1] ?? 0;
  if (at - last < MIN_GAP_MS) return false;
  s.t.push(at);
  for (const k of KEYS) {
    const v = point[k];
    s.v[k].push(isNum(v) && v > 0 ? v : null);
  }
  let drop = 0;
  while (drop < s.t.length && at - s.t[drop] > KEEP_MS) drop++;
  if (drop) {
    s.t.splice(0, drop);
    for (const k of KEYS) s.v[k].splice(0, drop);
  }
  await kv.set(KEY, s, 10 * 86400);
  return true;
}

export function intradayPairs(s: IntradayStore, key: AssetKey, sinceMs: number): [number, number][] {
  const out: [number, number][] = [];
  s.t.forEach((t, i) => {
    const v = s.v[key]?.[i];
    if (t >= sinceMs && isNum(v)) out.push([t, v]);
  });
  return out;
}
