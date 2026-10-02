/**
 * Factor research on REAL TGJU daily data: does each candidate signal predict the next 20/60
 * trading days of return? Spearman rank correlation (IC) and top-vs-bottom tercile spread.
 * DEV = 2014-01-01 … 2020-12-31 only. Run: npx tsx scripts/eval/factor-ic.ts [dev|final]
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './fetch-real';
import { rsi as rsiFn } from '@/lib/engine/stats';

const read = (f: string): [string, number][] => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
const split = process.argv[2] ?? 'dev';
const inSplit = (d: string) => (split === 'dev' ? d >= '2014-01-01' && d <= '2020-12-31' : d >= '2021-01-01');
const usd = new Map(read('daily-usd.json')), ons = new Map(read('daily-ons.json'));
const carry = (m: Map<string, number>) => { const keys = [...m.keys()].sort(); return (d: string) => { let lo = 0, hi = keys.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans >= 0 ? m.get(keys[ans])! : null; }; };
const usdAt = carry(usd), onsAt = carry(ons);

function rank(a: number[]) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); idx.forEach(([, i], k) => (r[i] = k)); return r; }
function spearman(x: number[], y: number[]) { const rx = rank(x), ry = rank(y); const n = x.length; const mx = (n - 1) / 2; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; } return num / Math.sqrt(dx * dy); }

type Feat = (i: number, d: string[], p: number[]) => number | null;
const sma = (p: number[], i: number, n: number) => { if (i < n) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += p[k]; return s / n; };
const melt = (asset: string, d: string, px: number) => { const o = onsAt(d), u = usdAt(d); if (!o || !u) return null; const g = asset === 'coin' ? 7.3224 : 0.75; return px / ((o / 31.1035) * g * u) - 1; };
const feats: Record<string, Feat> = {
  'price/SMA200': (i, d, p) => { const s = sma(p, i, 200); return s ? p[i] / s - 1 : null; },
  'price/SMA100': (i, d, p) => { const s = sma(p, i, 100); return s ? p[i] / s - 1 : null; },
  'SMA50>SMA200': (i, d, p) => { const a = sma(p, i, 50), b = sma(p, i, 200); return a && b ? (a > b ? 1 : 0) : null; },
  'mom 250d': (i, d, p) => (i >= 250 ? p[i] / p[i - 250] - 1 : null),
  'mom 120d': (i, d, p) => (i >= 120 ? p[i] / p[i - 120] - 1 : null),
  'mom 60d': (i, d, p) => (i >= 60 ? p[i] / p[i - 60] - 1 : null),
  'mom 20d': (i, d, p) => (i >= 20 ? p[i] / p[i - 20] - 1 : null),
  'RSI14': (i, d, p) => (i >= 60 ? rsiFn(p.slice(i - 59, i + 1), 14) : null),
  'melt premium': (i, d, p) => melt(asset, d[i], p[i]),
  'premium vs 90d norm': (i, d, p) => { const now = melt(asset, d[i], p[i]); if (now === null || i < 90) return null; const past: number[] = []; for (let k = i - 90; k < i; k += 5) { const v = melt(asset, d[k], p[k]); if (v !== null) past.push(v); } return past.length > 8 ? now - past.reduce((a, b) => a + b, 0) / past.length : null; },
  'realized vol 20d': (i, d, p) => { if (i < 21) return null; const r: number[] = []; for (let k = i - 19; k <= i; k++) r.push(Math.log(p[k] / p[k - 1])); const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); },
  'downside vol 20d': (i, d, p) => { if (i < 21) return null; const r: number[] = []; for (let k = i - 19; k <= i; k++) r.push(Math.min(0, Math.log(p[k] / p[k - 1]))); return Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length); },
  'up-vol minus down-vol': (i, d, p) => { if (i < 21) return null; let u = 0, dn = 0; for (let k = i - 19; k <= i; k++) { const x = Math.log(p[k] / p[k - 1]); if (x > 0) u += x * x; else dn += x * x; } return Math.sqrt(u) - Math.sqrt(dn); },
  'ounce mom 60d': (i, d) => { const a = onsAt(d[i]), b = i >= 60 ? onsAt(d[i - 60]) : null; return a && b ? a / b - 1 : null; },
  'dollar mom 60d': (i, d) => { const a = usdAt(d[i]), b = i >= 60 ? usdAt(d[i - 60]) : null; return a && b ? a / b - 1 : null; },
};
let asset = '';
for (const [a, f] of [['usd', 'daily-usd.json'], ['g18', 'daily-g18.json'], ['coin', 'daily-coin.json']] as const) {
  asset = a;
  const rows = read(f); const d = rows.map((r) => r[0]), p = rows.map((r) => r[1]);
  console.log(`\n${a} (${split})`);
  for (const [name, fn] of Object.entries(feats)) {
    if ((name.includes('premium') && a === 'usd') || (name === 'dollar mom 60d' && a === 'usd')) continue;
    for (const H of [20, 60]) {
      const xs: number[] = [], ys: number[] = [];
      for (let i = 250; i + H < p.length; i += 5) { if (!inSplit(d[i])) continue; const x = fn(i, d, p); if (x === null || !Number.isFinite(x)) continue; xs.push(x); ys.push(p[i + H] / p[i] - 1); }
      if (xs.length < 40) continue;
      const ic = spearman(xs, ys);
      const order = xs.map((x, k) => [x, ys[k]]).sort((u, v) => u[0] - v[0]); const t = Math.floor(order.length / 3);
      const lo = order.slice(0, t).reduce((s, r) => s + r[1], 0) / t, hi = order.slice(-t).reduce((s, r) => s + r[1], 0) / t;
      process.stdout.write(`  ${name.padEnd(20)} H${H}: IC ${ic >= 0 ? '+' : ''}${ic.toFixed(2)}  top−bottom ${((hi - lo) * 100).toFixed(1).padStart(6)}%  (n=${xs.length})\n`);
    }
  }
}
