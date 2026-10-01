/**
 * The daily multi-asset engine (simulator / live paper trading) on REAL TGJU history.
 * Dollar, 18k gold and Emami coin go back to 2013–14; BTC/ETH (from the cached hourly candles ×
 * the free-market dollar) to Oct 2023. Idle cash earns the fixed-income rate inside the engine,
 * so "beats deposit" is the bar that matters. No news (no historical archive offline).
 *
 * Protocol: 1-year windows stepping 3 months. DEV = windows ending before 2021-01-01,
 * FINAL = windows starting on/after 2021-01-01 — the final half is reported once, never tuned on.
 * Run: npx tsx scripts/eval/daily-eval.ts [dev|final|all] [v1|v2|both]
 */
import fs from 'node:fs';
import path from 'node:path';
import { simulate, type SimAsset, type SimInput, type SimProfile, type SimSeries } from '@/lib/engine/simulator';
import { CACHE } from './fetch-real';

const DAY = 86_400_000;
const read = (f: string): [string, number][] => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function realSeries() {
  const usd = read('daily-usd.json');
  const usdMap = new Map(usd);
  const mk = (key: SimAsset, rows: [string, number][], basis: string, reconstructed = false): SimSeries => ({ key, dates: rows.map((r) => r[0]), prices: rows.map((r) => r[1]), basis, reconstructed });
  const cryptoRial = (sym: string): [string, number][] => {
    const rows: [string, number][] = [];
    const m = new Map<string, number>();
    for (const f of [`hourly-old-${sym}.json`, `hourly-${sym}.json`]) {
      if (!fs.existsSync(path.join(CACHE, f))) continue;
      for (const k of JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'))) m.set(iso(k.t), k.c);
    }
    let lastUsd: number | null = null;
    for (const d of [...m.keys()].sort()) {
      lastUsd = usdMap.get(d) ?? lastUsd;
      if (lastUsd) rows.push([d, m.get(d)! * lastUsd]);
    }
    return rows;
  };
  const series: Partial<Record<SimAsset, SimSeries>> = {
    usd: mk('usd', usd, 'TGJU'),
    g18: mk('g18', read('daily-g18.json'), 'TGJU'),
    coin: mk('coin', read('daily-coin.json'), 'TGJU'),
    btc: mk('btc', cryptoRial('BTC'), 'Binance × TGJU dollar', true),
    eth: mk('eth', cryptoRial('ETH'), 'Binance × TGJU dollar', true),
  };
  const ons = read('daily-ons.json');
  return { series, ons: { dates: ons.map((r) => r[0]), prices: ons.map((r) => r[1]) }, usdRef: { dates: usd.map((r) => r[0]), prices: usd.map((r) => r[1]) }, usdt: read('daily-usdt.json') };
}

export interface DRow { start: string; profile: SimProfile; split: 'dev' | 'final'; ret: number; deposit: number; usdHold: number; equal: number | null; dd: number; trades: number; exposure: number }

export function evaluateDaily(engineParams: Record<string, unknown> | null, split: 'dev' | 'final' | 'all', label = ''): DRow[] {
  const { series, ons, usdRef } = realSeries();
  const rows: DRow[] = [];
  const yieldOf = (d: string) => (d < '2018-01-01' ? 0.2 : d < '2022-01-01' ? 0.2 : 0.28); // rough Iranian fixed-income history
  for (let t = Date.parse('2015-06-01'); t + 365 * DAY <= Date.parse('2026-09-30'); t += 91 * DAY) {
    const start = iso(t), end = iso(t + 365 * DAY);
    const sp: 'dev' | 'final' = end < '2021-01-01' ? 'dev' : start >= '2021-01-01' ? 'final' : ('skip' as any);
    if ((sp as string) === 'skip' || (split !== 'all' && sp !== split)) continue;
    const assets = (['usd', 'g18', 'coin', 'btc', 'eth'] as SimAsset[]).filter((a) => (series[a]!.dates[0] ?? '9999') <= iso(t - 140 * DAY));
    for (const profile of ['conservative', 'balanced', 'aggressive'] as SimProfile[]) {
      const input: SimInput = { start, end, capitalToman: 1e9, profile, assets, fixedIncomeYield: yieldOf(start), series, ons, usdRef, news: [] };
      const r = simulate(input, engineParams as any);
      const m = r.metrics;
      const b = (k: string) => r.benchmarks.find((x) => x.key === k)?.returnPct ?? NaN;
      rows.push({ start, profile, split: sp, ret: m.returnPct, deposit: b('deposit'), usdHold: b('usd'), equal: b('equal'), dd: m.maxDrawdownPct, trades: m.trades, exposure: m.avgExposurePct });
    }
  }
  return rows;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function summarizeDaily(label: string, rows: DRow[]) {
  for (const p of ['conservative', 'balanced', 'aggressive', 'ALL']) {
    const rs = p === 'ALL' ? rows : rows.filter((r) => r.profile === p);
    if (!rs.length) continue;
    console.log(
      `${label.padEnd(10)} ${p.padEnd(12)} n=${String(rs.length).padStart(3)} ret ${avg(rs.map((r) => r.ret)).toFixed(1).padStart(6)}%` +
        ` | deposit ${avg(rs.map((r) => r.deposit)).toFixed(1)}% beat ${((rs.filter((r) => r.ret > r.deposit).length / rs.length) * 100).toFixed(0)}%` +
        ` | usd ${avg(rs.map((r) => r.usdHold)).toFixed(1)}% beat ${((rs.filter((r) => r.ret > r.usdHold).length / rs.length) * 100).toFixed(0)}%` +
        ` | equal ${avg(rs.filter((r) => r.equal !== null).map((r) => r.equal!)).toFixed(1)}%` +
        ` | DD ${avg(rs.map((r) => r.dd)).toFixed(1)}% | trades ${avg(rs.map((r) => r.trades)).toFixed(0)} | expo ${avg(rs.map((r) => r.exposure)).toFixed(0)}%`,
    );
  }
}

if (process.argv[1]?.endsWith('daily-eval.ts')) {
  const split = (process.argv[2] ?? 'dev') as 'dev' | 'final' | 'all';
  const which = process.argv[3] ?? 'both';
  if (which !== 'v2') summarizeDaily(`v1/${split}`, evaluateDaily(null, split));
  if (which !== 'v1') summarizeDaily(`v2/${split}`, evaluateDaily({ engine: 2 }, split));
}
