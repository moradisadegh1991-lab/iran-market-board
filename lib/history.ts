// Rolling daily history in Redis + return-splicing with proxy series (so risk works from day one).
import { kv } from '@/lib/store';
import { isNum, msToTehranDate, normSymbol } from '@/lib/num';
import type { AssetKey } from '@/lib/types';
import type { TseSymbol } from '@/lib/sources/brsapi';

export const ASSET_KEYS: AssetKey[] = ['usd', 'usdt', 'g18', 'coin', 'nim', 'rob', 'silver', 'silverOns', 'ons', 'btc', 'eth', 'tse'];
const DAILY_KEY = 'hist:daily:v1';
const TSE_KEY = 'hist:tse:v1';
const MAX_DAILY = 420;
const MAX_TSE_DAYS = 80;
const MAX_TSE_SYMBOLS = 450;

export interface DailyStore {
  dates: string[];
  series: Record<AssetKey, (number | null)[]>;
}

const emptyDaily = (): DailyStore => ({
  dates: [],
  series: Object.fromEntries(ASSET_KEYS.map((k) => [k, []])) as unknown as DailyStore['series'],
});

export async function loadDaily(): Promise<DailyStore> {
  const s = await kv.get<DailyStore>(DAILY_KEY);
  if (!s?.dates) return emptyDaily();
  for (const k of ASSET_KEYS) if (!Array.isArray(s.series[k])) s.series[k] = s.dates.map(() => null);
  return s;
}

function ensureDate(store: { dates: string[] }, date: string, arrays: (number | null)[][]): number {
  let idx = store.dates.indexOf(date);
  if (idx >= 0) return idx;
  store.dates.push(date);
  arrays.forEach((a) => a.push(null));
  // keep chronological order (backfill may insert older dates)
  if (store.dates.length > 1 && store.dates[store.dates.length - 2] > date) {
    const order = store.dates.map((d, i) => [d, i] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const perm = order.map(([, i]) => i);
    store.dates = perm.map((i) => store.dates[i]);
    arrays.forEach((a) => {
      const copy = perm.map((i) => a[i]);
      a.splice(0, a.length, ...copy);
    });
  }
  return store.dates.indexOf(date);
}

export function upsertDailyPoint(store: DailyStore, date: string, point: Partial<Record<AssetKey, number | null>>) {
  const arrays = ASSET_KEYS.map((k) => store.series[k]);
  const idx = ensureDate(store, date, arrays);
  for (const k of ASSET_KEYS) {
    const v = point[k];
    if (isNum(v) && v > 0) store.series[k][idx] = v;
  }
  const extra = store.dates.length - MAX_DAILY;
  if (extra > 0) {
    store.dates.splice(0, extra);
    for (const k of ASSET_KEYS) store.series[k].splice(0, extra);
  }
}

export async function saveDaily(store: DailyStore) {
  await kv.set(DAILY_KEY, store);
}

export function dailyMap(store: DailyStore, key: AssetKey): Map<string, number> {
  const m = new Map<string, number>();
  store.dates.forEach((d, i) => {
    const v = store.series[key][i];
    if (isNum(v) && v > 0) m.set(d, v);
  });
  return m;
}

export function pairsToMap(pairs: [number, number][] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const [ms, p] of pairs ?? []) if (isNum(p) && p > 0) m.set(msToTehranDate(ms), p); // last value of the day wins
  return m;
}

export function productMap(a: Map<string, number>, b: Map<string, number>, scale = 1): Map<string, number> {
  const m = new Map<string, number>();
  for (const [d, v] of a) {
    const w = b.get(d);
    if (isNum(w)) m.set(d, v * w * scale);
  }
  return m;
}

/**
 * Build a price index whose daily log-returns come from `actual` when both endpoints exist, else from `proxy`.
 * The index is anchored to the latest actual (or proxy) price. Scale-free metrics (vol, RSI, z) are unaffected.
 */
export function spliceSeries(actual: Map<string, number>, proxy: Map<string, number>): { dates: string[]; prices: number[] } {
  const dates = [...new Set([...actual.keys(), ...proxy.keys()])].sort();
  if (dates.length === 0) return { dates: [], prices: [] };
  const logIdx: number[] = [0];
  const kept: string[] = [dates[0]];
  for (let i = 1; i < dates.length; i++) {
    const d0 = kept[kept.length - 1];
    const d1 = dates[i];
    const a0 = actual.get(d0), a1 = actual.get(d1);
    const p0 = proxy.get(d0), p1 = proxy.get(d1);
    let r: number | null = null;
    if (isNum(a0) && isNum(a1)) r = Math.log(a1 / a0);
    else if (isNum(p0) && isNum(p1)) r = Math.log(p1 / p0);
    if (r === null) continue; // cannot bridge this date; skip it
    kept.push(d1);
    logIdx.push(logIdx[logIdx.length - 1] + r);
  }
  const lastDate = kept[kept.length - 1];
  const anchor = actual.get(lastDate) ?? proxy.get(lastDate) ?? [...actual.values()].pop() ?? 1;
  const lastLog = logIdx[logIdx.length - 1];
  return { dates: kept, prices: logIdx.map((l) => anchor * Math.exp(l - lastLog)) };
}

// ───────────── TSE per-symbol rolling history ─────────────

export interface TseStore {
  dates: string[];
  sym: Record<string, { c: (number | null)[]; v: (number | null)[] }>;
}

export async function loadTse(): Promise<TseStore> {
  return (await kv.get<TseStore>(TSE_KEY)) ?? { dates: [], sym: {} };
}

export async function saveTse(store: TseStore) {
  await kv.set(TSE_KEY, store);
}

function tseArrays(store: TseStore) {
  return Object.values(store.sym).flatMap((s) => [s.c, s.v]);
}

function ensureSym(store: TseStore, symbol: string) {
  if (!store.sym[symbol]) store.sym[symbol] = { c: store.dates.map(() => null), v: store.dates.map(() => null) };
  return store.sym[symbol];
}

/** returns false when today's snapshot looks like a holiday duplicate of the previous stored day */
export function upsertTseDay(store: TseStore, date: string, rows: TseSymbol[]): boolean {
  const traded = rows.filter((r) => r.tno > 0 && isNum(r.close ?? r.last));
  if (traded.length < 20) return false;
  const lastDate = store.dates[store.dates.length - 1];
  if (lastDate && lastDate !== date) {
    const li = store.dates.length - 1;
    let same = 0, total = 0;
    for (const r of traded.slice(0, 60)) {
      const prev = store.sym[r.symbol];
      if (!prev) continue;
      total++;
      if (prev.v[li] === Math.round(r.tval / 1e6) && prev.c[li] === (r.close ?? r.last)) same++;
    }
    if (total >= 10 && same / total > 0.9) return false;
  }
  const universe = [...traded].sort((a, b) => b.tval - a.tval).slice(0, MAX_TSE_SYMBOLS);
  universe.forEach((r) => ensureSym(store, r.symbol));
  const idx = ensureDate(store, date, tseArrays(store));
  for (const r of universe) {
    const s = store.sym[r.symbol];
    s.c[idx] = r.close ?? r.last;
    s.v[idx] = Math.round(r.tval / 1e6); // million rial
  }
  trimTse(store);
  return true;
}

export function mergeTseBackfill(store: TseStore, symbols: Record<string, { date: string; close: number; value?: number }[]>) {
  let n = 0;
  for (const [rawSymbol, points] of Object.entries(symbols)) {
    const symbol = normSymbol(rawSymbol);
    if (!symbol || !Array.isArray(points)) continue;
    for (const p of points) {
      if (!p?.date || !isNum(p.close)) continue;
      ensureSym(store, symbol);
      const idx = ensureDate(store, p.date, tseArrays(store));
      store.sym[symbol].c[idx] = p.close;
      if (isNum(p.value)) store.sym[symbol].v[idx] = Math.round(p.value / 1e6);
      n++;
    }
  }
  trimTse(store);
  return n;
}

function trimTse(store: TseStore) {
  const extra = store.dates.length - MAX_TSE_DAYS;
  if (extra > 0) {
    store.dates.splice(0, extra);
    for (const s of Object.values(store.sym)) {
      s.c.splice(0, extra);
      s.v.splice(0, extra);
    }
  }
  const syms = Object.entries(store.sym);
  if (syms.length > MAX_TSE_SYMBOLS * 1.3) {
    const recentVal = (s: { v: (number | null)[] }) => s.v.slice(-20).reduce<number>((a, b) => a + (b ?? 0), 0);
    syms.sort((a, b) => recentVal(b[1]) - recentVal(a[1]));
    store.sym = Object.fromEntries(syms.slice(0, MAX_TSE_SYMBOLS));
  }
}
