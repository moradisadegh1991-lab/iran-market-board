/**
 * The daily trend rider and candidate overlays, on real daily closes: BTC 2018→2026 and the
 * 14-coin basket 2023→2026. Thresholds are fixed a priori (standard levels), not searched.
 * Run: npx tsx scripts/eval/trend-variants.ts
 */
import { BASKET } from './fetch-real';
import { dailyCloses, fearGreed, funding } from './crypto-factors';

const DAY = 86_400_000;
const FEE = 0.004;
const fng = fearGreed();
export interface Variant { name: string; fundingGate?: number; fngGate?: number; volTarget?: number; sma?: number; ensemble?: number[] }
export const VARIANTS: Variant[] = [
  { name: 'A baseline SMA50' },
  { name: 'B + funding gate 0.03%/8h', fundingGate: 0.0003 },
  { name: 'C + F&G gate ≥80', fngGate: 80 },
  { name: 'D + vol target 60%', volTarget: 0.6 },
  { name: 'E = B + D', fundingGate: 0.0003, volTarget: 0.6 },
  { name: 'F ensemble 20/50/100', ensemble: [20, 50, 100] },
  { name: 'G ensemble + vol target', ensemble: [20, 50, 100], volTarget: 0.6 },
];

export function runTrend(sym: string, v: Variant, from: number, to: number) {
  const px = dailyCloses(sym); const days = [...px.keys()];
  const btc = dailyCloses('BTC'); const bdays = [...btc.keys()]; const bIdx = new Map(bdays.map((d, i) => [d, i]));
  const f = funding(sym);
  const n = v.sma ?? 50;
  const smaN = (arr: number[], i: number, L: number) => { if (i < L) return null; let s = 0; for (let k = i - L; k < i; k++) s += arr[k]; return s / L; };
  const sma = (arr: number[], i: number) => smaN(arr, i, n);
  /** share of lookbacks whose average the last close is above (0, ⅓, ⅔, 1) */
  const ens = (arr: number[], i: number) => { const L = v.ensemble!; const xs = L.map((l) => smaN(arr, i, l)); if (xs.some((x) => x === null)) return null; return xs.filter((x) => arr[i - 1] > x!).length / L.length; };
  const P = days.map((d) => px.get(d)!); const B = bdays.map((d) => btc.get(d)!);
  let eq = 1, w = 0, peak = 1, dd = 0, switches = 0, hold = 1, started = false;
  const rets: number[] = [];
  for (let i = Math.max(n, ...(v.ensemble ?? [0])) + 21; i < days.length; i++) {
    const d = days[i]; if (d < from || d > to) continue;
    if (days[i] - days[i - 1] !== DAY) continue;
    started = true;
    // decision with closes up to day i-1; return earned from close i-1 to close i
    const s = sma(P, i); const up = s !== null && P[i - 1] > s;
    let mUp = true;
    if (sym !== 'BTC') { const j = bIdx.get(d); const bs = j !== undefined ? sma(B, j) : null; mUp = bs === null || B[j! - 1] > bs; }
    let target = up && mUp ? 1 : 0;
    if (v.ensemble) {
      const e = ens(P, i);
      let me = 1;
      if (sym !== 'BTC') { const j = bIdx.get(d); me = j !== undefined && j > 100 ? ens(B, j) ?? 1 : 1; }
      target = e === null ? 0 : me < 0.5 ? 0 : e; // BTC regime still gates altcoins
    }
    if (target && w === 0) {
      const fd = [1, 2, 3].map((k) => f.get(d - k * DAY)).filter((x) => x !== undefined) as number[];
      if (v.fundingGate && fd.length === 3 && fd.reduce((a, b) => a + b, 0) / 3 > v.fundingGate) target = 0;
      const g = fng.get(d - DAY);
      if (v.fngGate && g !== undefined && g >= v.fngGate) target = 0;
    }
    if (target && v.volTarget) {
      const r: number[] = []; for (let k = i - 20; k < i; k++) r.push(Math.log(P[k] / P[k - 1]));
      const m = r.reduce((a, b) => a + b, 0) / r.length; const vol = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) * Math.sqrt(365);
      target = target * Math.min(1, v.volTarget / Math.max(vol, 0.05));
      if (w > 0 && Math.abs(target - w) < 0.2) target = w; // don't churn small resizes
    }
    if (target !== w) { eq *= 1 - FEE * Math.abs(target - w); if ((target > 0) !== (w > 0)) switches++; w = target; }
    const r = P[i] / P[i - 1] - 1;
    eq *= 1 + w * r; hold *= 1 + r; rets.push(w * r);
    peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1);
  }
  if (!started) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length; const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const years = rets.length / 365;
  return { ret: eq - 1, hold: hold - 1, cagr: eq ** (1 / years) - 1, dd, sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0, switches };
}

if (process.argv[1]?.endsWith('trend-variants.ts')) {
  const T = (s: string) => Date.parse(s);
  const sets: [string, string[], number, number][] = [
    ['BTC 2018–2022', ['BTC'], T('2018-03-01'), T('2022-12-31')],
    ['BTC 2023–2026', ['BTC'], T('2023-01-01'), T('2026-09-30')],
    ['basket 2023-10→2026-09', BASKET, T('2023-12-01'), T('2026-09-30')],
  ];
  for (const [label, syms, a, b] of sets) {
    console.log(`\n${label}`);
    for (const v of VARIANTS) {
      const rs = syms.map((s) => runTrend(s, v, a, b)).filter(Boolean) as NonNullable<ReturnType<typeof runTrend>>[];
      const avg = (k: keyof (typeof rs)[0]) => rs.reduce((x, r) => x + (r[k] as number), 0) / rs.length;
      console.log(`  ${v.name.padEnd(28)} ret ${(avg('ret') * 100).toFixed(0).padStart(6)}%  CAGR ${(avg('cagr') * 100).toFixed(1).padStart(6)}%  hold ${(avg('hold') * 100).toFixed(0).padStart(6)}%  maxDD ${(avg('dd') * 100).toFixed(1).padStart(6)}%  sharpe ${avg('sharpe').toFixed(2)}  switches ${avg('switches').toFixed(0)}`);
    }
  }
}
