/**
 * Does Iran news sentiment (the engine's own lexicon, scoreHeadline) predict the dollar, coin and
 * 18k gold? Daily scores from ~17k English headlines (fetch-news.ts), rank IC vs the next 5/20 trading
 * days, per year. Also: the same-day / previous-days reaction, to tell "news moves price" apart from
 * "news predicts price" (the first is real but useless to a trader who reads it after the move).
 * Run: npx tsx scripts/eval/iran-news.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './fetch-real';
import { scoreHeadline } from '@/lib/news';
import { spearman } from './crypto-factors';

const J = (f: string) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
const tehranDay = (ms: number) => new Date(ms + 3.5 * 3600_000).toISOString().slice(0, 10);

export function iranNewsDaily(asset: 'usd' | 'coin' | 'g18'): { score: Map<string, number>; count: Map<string, number>; facts: Map<string, number> } {
  const score = new Map<string, number>(), count = new Map<string, number>(), facts = new Map<string, number>();
  const seen = new Set<string>();
  for (const items of Object.values(J('news-iran.json')) as { title: string; ms: number }[][]) for (const it of items) {
    const key = it.title.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = scoreHeadline(it.title);
    const e = s?.effects[asset];
    if (!s || !e) continue;
    const d = tehranDay(it.ms);
    score.set(d, (score.get(d) ?? 0) + e * s.weight);
    count.set(d, (count.get(d) ?? 0) + 1);
    for (const f of s.facts) facts.set(f, (facts.get(f) ?? 0) + 1);
  }
  return { score, count, facts };
}

if (process.argv[1]?.endsWith('iran-news.ts')) {
  for (const asset of ['usd', 'coin', 'g18'] as const) {
    const { score, count, facts } = iranNewsDaily(asset);
    const rows = J(`daily-${asset}.json`) as [string, number][];
    const d = rows.map((r) => r[0]), p = rows.map((r) => r[1]);
    console.log(`\n${asset}: ${[...count.values()].reduce((a, b) => a + b, 0)} scored headlines on ${count.size} days; top facts:`, [...facts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, n]) => `${f}(${n})`).join(', '));
    const sumBack = (i: number, n: number) => { let s = 0; for (let k = 0; k < n; k++) { const dd = new Date(Date.parse(d[i]) - k * 86_400_000).toISOString().slice(0, 10); s += score.get(dd) ?? 0; } return s; };
    for (const [label, look, H] of [['news 7d → next 5', 7, 5], ['news 7d → next 20', 7, 20], ['news 30d → next 20', 30, 20], ['reaction: news 3d vs past 3', 3, -3]] as const) {
      const by = new Map<number, { x: number[]; y: number[] }>();
      for (let i = 30; i < p.length - 21; i++) {
        if (d[i] < '2015-07-01') continue;
        const x = sumBack(i, look);
        if (x === 0) continue; // only days with news in the window
        const y = H > 0 ? p[i + H] / p[i] - 1 : p[i] / p[i + H] - 1;
        const yr = +d[i].slice(0, 4);
        const e = by.get(yr) ?? by.set(yr, { x: [], y: [] }).get(yr)!;
        e.x.push(x); e.y.push(y);
      }
      const cells = [...by.entries()].sort((a, b) => a[0] - b[0]).filter(([, v]) => v.x.length >= 25).map(([yr, v]) => `${yr}:${spearman(v.x, v.y) >= 0 ? '+' : ''}${spearman(v.x, v.y).toFixed(2)}`);
      const pos = cells.filter((c) => c.includes(':+')).length;
      console.log(`  ${label.padEnd(28)} ${cells.join(' ')}   (+ in ${pos}/${cells.length} years)`);
    }
  }
}
