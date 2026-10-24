/**
 * Which coins should the trend rider trade, and does a different trend rule beat the 50-day one?
 * Real Binance daily candles 2017→2026 for 40 coins INCLUDING ones that collapsed or faded (FTT, LUNA,
 * EOS, AXS…; scripts/eval/fetch-futures.ts). Design 2018–2022, held-out test 2023–2026 (rule 21).
 *
 * Every 30 days each selection rule ranks the coins with data up to that day only, and the basket holds
 * the top K as equal sleeves, each run by the daily trend rider (weight = exposure × min(1, 60% ÷ 20-day
 * vol) while the coin AND BTC closed above their 50-day average; cash otherwise). Fee 0.4% per side on
 * every change of weight (Iranian exchange fee + tether spread, as everywhere in this project).
 * A rule is only worth shipping if it beats «all eligible coins» in the design years AND in the test
 * years AND in most single years.
 * Run: npx tsx scripts/eval/coin-pick-eval.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './fetch-real';
import { UNIVERSE } from './fetch-futures';
import { PICK_MIN_DAYS, PICK_MIN_VALUE, valueAt, vol20At } from '@/lib/engine/coin-pick';

export const DAY = 86_400_000;
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }
export const SYMS = Object.keys(UNIVERSE);

export function loadDaily(sym: string): Bar[] {
  const f = path.join(CACHE, 'daily-long', `${sym}.json`);
  if (!fs.existsSync(f)) return [];
  return (JSON.parse(fs.readFileSync(f, 'utf8')) as Bar[]).filter((b) => b.c > 0);
}

/** per coin: close by day, and the trend-rider weight decided at that day's close (for the next day) */
export interface Coin {
  sym: string;
  bars: Bar[];
  idx: Map<number, number>;
  /** SMA-50 regime of closes up to and including day i (null before 50 days) */
  up: (boolean | null)[];
  vol20: (number | null)[];
}

export function prepCoin(sym: string, sma = 50): Coin {
  const bars = loadDaily(sym);
  const idx = new Map(bars.map((b, i) => [b.t, i]));
  const up: (boolean | null)[] = [];
  const vol20: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= sma) sum -= bars[i - sma].c;
    up.push(i + 1 >= sma ? bars[i].c > sum / sma : null);
    if (i >= 20) {
      const r: number[] = [];
      for (let j = i - 19; j <= i; j++) r.push(Math.log(bars[j].c / bars[j - 1].c));
      const m = r.reduce((a, b) => a + b, 0) / 20;
      vol20.push(Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / 20) * Math.sqrt(365));
    } else vol20.push(null);
  }
  return { sym, bars, idx, up, vol20 };
}

const VOL_T = 0.6, EXPO = 0.9;
// per side; --fee=0.0071 is Abantether (0.38% fee + half its USDT spread, rule 102)
const FEE = Number(process.argv.find((a) => a.startsWith("--fee="))?.slice(6) ?? 0.004);

/** weight the trend rider wants in this coin after the close of day d (null = no data) */
export function trendWeight(c: Coin, btc: Coin, d: number, rule: (c: Coin, i: number) => boolean | null = (c, i) => c.up[i]): number | null {
  const i = c.idx.get(d);
  if (i === undefined) return null;
  const u = rule(c, i);
  if (u === null) return 0;
  let mkt = true;
  if (c.sym !== 'BTC') {
    const j = btc.idx.get(d);
    mkt = j !== undefined && rule(btc, j) === true;
  }
  if (!u || !mkt) return 0;
  const v = c.vol20[i];
  return EXPO * (v ? Math.min(1, VOL_T / v) : 1);
}

export interface Ranker { name: string; score: (c: Coin, i: number, ctx: { btc: Coin }) => number | null; take?: 'top' | 'bottom' }

/** past-365-day trend-rider result on the coin itself, as a Sharpe-like number (no lookahead: days ≤ i) */
function pastRide(c: Coin, i: number, btc: Coin): number | null {
  if (i < 420) return null;
  const rs: number[] = [];
  let w = 0;
  for (let k = i - 365; k <= i; k++) {
    rs.push(w * (c.bars[k].c / c.bars[k - 1].c - 1));
    w = trendWeight(c, btc, c.bars[k].t) ?? 0;
  }
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / rs.length);
  return sd > 0 ? (m / sd) * Math.sqrt(365) : 0;
}
const avgValue = (c: Coin, i: number, n: number) => {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += c.bars[k].v;
  return s / n;
};

export const RANKERS: Ranker[] = [
  { name: 'all eligible (benchmark)', score: () => 0 },
  { name: 'most traded (90-day value)', score: (c, i) => avgValue(c, i, 90) },
  { name: 'trend rider worked best (past 365 d)', score: (c, i, x) => pastRide(c, i, x.btc) },
  { name: 'strongest 90-day momentum', score: (c, i) => (i >= 90 ? c.bars[i].c / c.bars[i - 90].c - 1 : null) },
  // the rule the app ships (lib/engine/coin-pick.ts), with the app's own functions
  { name: 'calmest (lowest 20-day vol)', score: (c, i) => vol20At(c.bars, i), take: 'bottom' },
  { name: 'BTC + ETH only', score: (c) => (c.sym === 'BTC' || c.sym === 'ETH' ? 1 : null) },
];

export interface RunOut { eq: { t: number; v: number }[]; byYear: Map<number, number>; picks: Map<number, string[]> }

/**
 * Equal sleeves over the coins chosen at each 30-day rebalance; inside each sleeve the trend rider
 * decides the weight daily. A coin is eligible once it has 400 days of history and 90-day traded value
 * of at least $5m/day (thin coins cannot be traded at these sizes), and stops being eligible when its
 * data ends (delisting / collapse — the sleeve is marked at the last close and sold).
 */
export function runBasket(coins: Coin[], btc: Coin, ranker: Ranker, K: number, from: number, to: number, opts: { rule?: (c: Coin, i: number) => boolean | null } = {}): RunOut {
  const days: number[] = [];
  for (let d = from; d <= to; d += DAY) days.push(d);
  let eq = 1;
  let held = new Map<string, number>(); // sym → sleeve share (sums ≤ 1)
  const w = new Map<string, number>(); // current market weight inside the sleeve
  const out: RunOut = { eq: [], byYear: new Map(), picks: new Map() };
  let yStart = 1, curY = new Date(from).getUTCFullYear();
  for (let n = 0; n < days.length; n++) {
    const d = days[n];
    // 1. earn the day: each sleeve × its weight × the coin's return from yesterday's close
    if (n > 0) {
      let r = 0;
      for (const [s, share] of held) {
        const c = coins.find((x) => x.sym === s)!;
        const i = c.idx.get(d), p = c.idx.get(days[n - 1]);
        if (i === undefined || p === undefined) continue;
        r += share * (w.get(s) ?? 0) * (c.bars[i].c / c.bars[p].c - 1);
      }
      eq *= 1 + r;
    }
    // 2. rebalance the selection every 30 days (and drop coins whose data ended)
    let turn = 0;
    for (const s of [...held.keys()]) {
      const c = coins.find((x) => x.sym === s)!;
      if (c.idx.get(d) === undefined) {
        turn += (held.get(s) ?? 0) * (w.get(s) ?? 0);
        held.delete(s);
        w.delete(s);
      }
    }
    if (n % 30 === 0) {
      const elig = coins
        .map((c) => {
          const i = c.idx.get(d);
          if (i === undefined || i + 1 < PICK_MIN_DAYS) return null;
          const val = valueAt(c.bars, i);
          if (!val || val < PICK_MIN_VALUE) return null;
          const sc = ranker.score(c, i, { btc });
          return sc === null ? null : { s: c.sym, sc };
        })
        .filter((x): x is { s: string; sc: number } => !!x);
      elig.sort((a, b) => (ranker.take === 'bottom' ? a.sc - b.sc : b.sc - a.sc));
      const pick = ranker.name.startsWith('all') ? elig.map((x) => x.s) : elig.slice(0, K).map((x) => x.s);
      out.picks.set(d, pick);
      const share = pick.length ? 1 / pick.length : 0;
      const next = new Map(pick.map((s) => [s, share]));
      for (const s of new Set([...held.keys(), ...next.keys()])) turn += Math.abs((next.get(s) ?? 0) - (held.get(s) ?? 0)) * (w.get(s) ?? 0);
      held = next;
      for (const s of held.keys()) if (!w.has(s)) w.set(s, 0);
    }
    // 3. the trend rider's daily decision inside each sleeve, from closes up to today
    for (const s of held.keys()) {
      const c = coins.find((x) => x.sym === s)!;
      const nw = trendWeight(c, btc, d, opts.rule) ?? 0;
      turn += (held.get(s) ?? 0) * Math.abs(nw - (w.get(s) ?? 0));
      w.set(s, nw);
    }
    eq *= 1 - FEE * turn;
    out.eq.push({ t: d, v: eq });
    const y = new Date(d).getUTCFullYear();
    if (y !== curY) {
      out.byYear.set(curY, eq / yStart - 1);
      yStart = eq;
      curY = y;
    }
  }
  out.byYear.set(curY, eq / yStart - 1);
  return out;
}

export function stats(eq: { t: number; v: number }[]) {
  if (eq.length < 2) return { cagr: NaN, dd: NaN, sharpe: NaN, total: NaN };
  const yrs = (eq[eq.length - 1].t - eq[0].t) / (365 * DAY);
  const total = eq[eq.length - 1].v / eq[0].v - 1;
  let peak = eq[0].v, dd = 0;
  const rs: number[] = [];
  for (let i = 1; i < eq.length; i++) {
    peak = Math.max(peak, eq[i].v);
    dd = Math.min(dd, eq[i].v / peak - 1);
    rs.push(eq[i].v / eq[i - 1].v - 1);
  }
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / rs.length);
  return { cagr: (1 + total) ** (1 / yrs) - 1, dd, sharpe: sd > 0 ? (m / sd) * Math.sqrt(365) : 0, total };
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const DESIGN: [number, number] = [Date.parse('2018-06-01'), Date.parse('2022-12-31')];
const TEST: [number, number] = [Date.parse('2023-01-01'), Date.parse('2026-09-30')];

function main() {
  const coins = SYMS.map((s) => prepCoin(s)).filter((c) => c.bars.length > 400);
  const btc = coins.find((c) => c.sym === 'BTC')!;
  console.log(`coins with data: ${coins.length}`);
  const K = Number(process.argv.find((a) => a.startsWith('--k='))?.slice(4) ?? 5);
  console.log(`\n== Study 1: which coins (top ${K}), trend rider unchanged ==`);
  for (const r of RANKERS) {
    const a = runBasket(coins, btc, r, K, ...DESIGN);
    const b = runBasket(coins, btc, r, K, ...TEST);
    const sa = stats(a.eq), sb = stats(b.eq);
    const yrs = [...a.byYear, ...b.byYear].map(([y, v]) => `${y}:${pct(v)}`).join(' ');
    console.log(`${r.name.padEnd(38)} design CAGR ${pct(sa.cagr).padStart(6)} DD ${pct(sa.dd).padStart(5)} Sh ${sa.sharpe.toFixed(2)} | test CAGR ${pct(sb.cagr).padStart(6)} DD ${pct(sb.dd).padStart(5)} Sh ${sb.sharpe.toFixed(2)}\n      ${yrs}`);
    if (process.argv.includes('--picks')) console.log('      last picks:', [...b.picks.values()].at(-1)?.join(','));
  }

  console.log('\n== Study 2: the trend rule itself (benchmark selection = all eligible) ==');
  const smaRule = (n: number) => {
    const cache = new Map<string, (boolean | null)[]>();
    return (c: Coin, i: number) => {
      let u = cache.get(c.sym);
      if (!u) {
        u = prepCoin(c.sym, n).up;
        cache.set(c.sym, u);
      }
      return u[i];
    };
  };
  const tsmom = (n: number) => (c: Coin, i: number) => (i >= n ? c.bars[i].c > c.bars[i - n].c : null);
  const donchian = (n: number) => {
    // long after a close above the n-day high, out after a close below the n/2-day low (turtle-style)
    const st = new Map<string, (boolean | null)[]>();
    return (c: Coin, i: number) => {
      let s = st.get(c.sym);
      if (!s) {
        s = [];
        let on = false;
        for (let k = 0; k < c.bars.length; k++) {
          if (k < n) {
            s.push(null);
            continue;
          }
          let hi = -Infinity, lo = Infinity;
          for (let j = k - n; j < k; j++) hi = Math.max(hi, c.bars[j].c);
          for (let j = k - Math.floor(n / 2); j < k; j++) lo = Math.min(lo, c.bars[j].c);
          if (c.bars[k].c > hi) on = true;
          else if (c.bars[k].c < lo) on = false;
          s.push(on);
        }
        st.set(c.sym, s);
      }
      return s[i];
    };
  };
  const RULES: [string, ((c: Coin, i: number) => boolean | null) | undefined][] = [
    ['SMA 50 (current)', undefined],
    ['SMA 20', smaRule(20)],
    ['SMA 100', smaRule(100)],
    ['30-day momentum > 0', tsmom(30)],
    ['90-day momentum > 0', tsmom(90)],
    ['Donchian 20/10', donchian(20)],
    ['Donchian 55/27', donchian(55)],
  ];
  const all = RANKERS[0];
  for (const [name, rule] of RULES) {
    const a = runBasket(coins, btc, all, K, ...DESIGN, { rule });
    const b = runBasket(coins, btc, all, K, ...TEST, { rule });
    const sa = stats(a.eq), sb = stats(b.eq);
    const yrs = [...a.byYear, ...b.byYear].map(([y, v]) => `${y}:${pct(v)}`).join(' ');
    console.log(`${name.padEnd(22)} design CAGR ${pct(sa.cagr).padStart(6)} DD ${pct(sa.dd).padStart(5)} Sh ${sa.sharpe.toFixed(2)} | test CAGR ${pct(sb.cagr).padStart(6)} DD ${pct(sb.dd).padStart(5)} Sh ${sb.sharpe.toFixed(2)}\n      ${yrs}`);
  }
  // buy and hold of the same eligible basket, for scale
  const hold: Ranker = { name: 'all eligible', score: () => 0 };
  const holdRule = () => true;
  for (const [lab, rng] of [['design', DESIGN], ['test', TEST]] as const) {
    const h = runBasket(coins, btc, hold, K, ...rng, { rule: holdRule });
    const s = stats(h.eq);
    console.log(`always in (same sizing, no trend filter) ${lab}: CAGR ${pct(s.cagr)} DD ${pct(s.dd)} Sh ${s.sharpe.toFixed(2)}  ${[...h.byYear].map(([y, v]) => `${y}:${pct(v)}`).join(' ')}`);
  }
}

if (process.argv[1]?.endsWith('coin-pick-eval.ts')) main();
