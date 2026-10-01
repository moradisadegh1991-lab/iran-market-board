/**
 * Do sentiment / positioning / news "fundamentals" predict crypto returns? Rank IC of each factor
 * against the next 7 and 30 days, reported PER YEAR — a factor is only trusted if its sign holds in
 * every year (one good year is how overfitting looks from the inside).
 * Data: .cache/eval (fetch-real.ts, --btc-long, funding CSVs, fng.json, news-*.json).
 * Run: npx tsx scripts/eval/crypto-factors.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, BASKET } from './fetch-real';
import { scoreHeadline } from '@/lib/news';

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;
const J = (f: string) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));

export function dailyCloses(sym: string): Map<number, number> {
  const m = new Map<number, number>();
  if (sym === 'BTC' && fs.existsSync(path.join(CACHE, 'btc-daily-long.json'))) for (const [t, c] of J('btc-daily-long.json')) m.set(t, c);
  for (const f of [`hourly-old-${sym}.json`, `hourly-${sym}.json`]) if (fs.existsSync(path.join(CACHE, f))) for (const k of J(f)) m.set(dayOf(k.t), k.c);
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}
export function fearGreed(): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of J('fng.json').data) m.set(dayOf(+d.timestamp * 1000), +d.value);
  return m;
}
/** mean funding rate over the day (3 settlements), per coin */
export function funding(sym: string): Map<number, number> {
  const dir = path.join(CACHE, 'funding');
  const acc = new Map<number, number[]>();
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(`${sym}-`))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(1)) {
      const [t, , r] = line.split(',');
      if (!t || !r) continue;
      const d = dayOf(+t);
      (acc.get(d) ?? acc.set(d, []).get(d)!).push(+r);
    }
  }
  return new Map([...acc.entries()].map(([d, xs]) => [d, xs.reduce((a, b) => a + b, 0) / xs.length]));
}
/** daily lexicon news score (sum of effect×weight) for one asset, from cached headlines */
export function newsScore(topics: string[], asset: 'btc', kind: 'all' | 'fundamental' | 'echo' = 'all'): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of topics) {
    const f = path.join(CACHE, `news-${t}.json`);
    if (!fs.existsSync(f)) continue;
    const seen = new Set<string>();
    for (const items of Object.values(J(`news-${t}.json`)) as { title: string; ms: number }[][]) for (const it of items) {
      if (seen.has(it.title)) continue;
      seen.add(it.title);
      const s = scoreHeadline(it.title);
      const e = s?.effects[asset];
      if (!s || !e) continue;
      if (kind === 'fundamental' && s.weight < 0.8) continue;
      if (kind === 'echo' && s.weight >= 0.8) continue;
      const d = dayOf(it.ms);
      m.set(d, (m.get(d) ?? 0) + e * s.weight);
    }
  }
  return m;
}

function rank(a: number[]) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); idx.forEach(([, i], k) => (r[i] = k)); return r; }
export function spearman(x: number[], y: number[]) { const rx = rank(x), ry = rank(y); const n = x.length; const mx = (n - 1) / 2; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; } return num / Math.sqrt(dx * dy); }

type F = (d: number, px: Map<number, number>, days: number[], i: number, sym: string) => number | null;
const fng = fearGreed();
const fundCache = new Map<string, Map<number, number>>();
const fund = (s: string) => fundCache.get(s) ?? fundCache.set(s, funding(s)).get(s)!;
const news = newsScore(['crypto', 'cryptoreg'], 'btc');
const newsF = newsScore(['crypto', 'cryptoreg'], 'btc', 'fundamental');
const newsE = newsScore(['crypto', 'cryptoreg'], 'btc', 'echo');
const sumBack = (m: Map<number, number>, d: number, n: number) => { let s = 0, k = 0; for (let j = 0; j < n; j++) { const v = m.get(d - j * DAY); if (v !== undefined) { s += v; k++; } } return k ? s : null; };

const FACTORS: Record<string, F> = {
  'trend: px/SMA50': (d, px, days, i) => { if (i < 50) return null; let s = 0; for (let k = i - 49; k <= i; k++) s += px.get(days[k])!; return px.get(d)! / (s / 50) - 1; },
  'mom 30d': (d, px, days, i) => (i >= 30 ? px.get(d)! / px.get(days[i - 30])! - 1 : null),
  'fear&greed level': (d) => fng.get(d) ?? null,
  'fear&greed Δ7d': (d) => { const a = fng.get(d), b = fng.get(d - 7 * DAY); return a !== undefined && b !== undefined ? a - b : null; },
  'funding 3d avg': (d, px, days, i, sym) => { const f = fund(sym); const v = [0, 1, 2].map((j) => f.get(d - j * DAY)).filter((x) => x !== undefined) as number[]; return v.length === 3 ? v.reduce((a, b) => a + b, 0) / 3 : null; },
  'funding vs 60d mean': (d, px, days, i, sym) => { const f = fund(sym); const now = [0, 1, 2].map((j) => f.get(d - j * DAY)).filter((x) => x !== undefined) as number[]; const hist: number[] = []; for (let j = 3; j < 63; j++) { const v = f.get(d - j * DAY); if (v !== undefined) hist.push(v); } return now.length === 3 && hist.length > 40 ? now.reduce((a, b) => a + b, 0) / 3 - hist.reduce((a, b) => a + b, 0) / hist.length : null; },
  'news 7d (BTC lexicon)': (d) => sumBack(news, d, 7),
  'news 7d fundamental only': (d) => sumBack(newsF, d, 7),
  'news 7d price-report only': (d) => sumBack(newsE, d, 7),
};

if (process.argv[1]?.endsWith('crypto-factors.ts')) {
  const syms = process.argv[2] === 'btc' ? ['BTC'] : BASKET;
  for (const [name, fn] of Object.entries(FACTORS)) {
    for (const H of [7, 30]) {
      const byYear = new Map<number, { x: number[]; y: number[] }>();
      for (const sym of syms) {
        const px = dailyCloses(sym); const days = [...px.keys()];
        for (let i = 0; i + H < days.length; i += 1) {
          const d = days[i]; if (days[i + H] - d !== H * DAY) continue;
          const x = fn(d, px, days, i, sym); if (x === null || !Number.isFinite(x)) continue;
          const yr = new Date(d).getUTCFullYear();
          const e = byYear.get(yr) ?? byYear.set(yr, { x: [], y: [] }).get(yr)!;
          e.x.push(x); e.y.push(px.get(days[i + H])! / px.get(d)! - 1);
        }
      }
      const cells = [...byYear.entries()].sort((a, b) => a[0] - b[0]).filter(([, v]) => v.x.length > 60).map(([yr, v]) => `${yr}:${spearman(v.x, v.y) >= 0 ? '+' : ''}${spearman(v.x, v.y).toFixed(2)}`);
      const signs = cells.map((c) => c.includes(':+'));
      const stable = signs.length >= 3 && (signs.every(Boolean) || signs.every((s) => !s));
      console.log(`${name.padEnd(24)} H${String(H).padStart(2)}  ${cells.join('  ')}  ${stable ? '← STABLE' : ''}`);
    }
  }
}
