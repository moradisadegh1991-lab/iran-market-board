/**
 * Historical English headlines (Google News RSS, half-month windows — the feed caps at 100 items
 * per query) for testing whether news sentiment predicts prices. Persian queries return nothing
 * from US hosts, which is also where Vercel runs, so English coverage is what the app can really use.
 * Run once: npx tsx scripts/eval/fetch-news.ts   → .cache/eval/news-<topic>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchGoogleNews, type RawNews } from '@/lib/sources/news';
import { CACHE } from './fetch-real';

export const NEWS_EVAL_TOPICS: { id: string; q: string; from: string }[] = [
  { id: 'iran', q: 'Iran sanctions OR "Iran nuclear" OR "Iranian rial" OR "Iran talks"', from: '2015-06' },
  { id: 'gold', q: '"gold price" OR "gold prices"', from: '2015-06' },
  { id: 'crypto', q: '"bitcoin price" OR "crypto market"', from: '2018-01' },
  { id: 'cryptoreg', q: '"crypto ETF" OR "bitcoin ETF" OR "SEC crypto" OR "crypto regulation"', from: '2018-01' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const t of NEWS_EVAL_TOPICS) {
    const f = path.join(CACHE, `news-${t.id}.json`);
    const have: Record<string, RawNews[]> = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    let [y, m] = t.from.split('-').map(Number);
    while (y < 2026 || (y === 2026 && m <= 9)) {
      for (const [a, b] of [[1, 16], [16, 0]] as const) {
        const key = `${y}-${pad(m)}-${a}`;
        if (have[key]) continue;
        const after = `${y}-${pad(m)}-${pad(a)}`;
        const before = b ? `${y}-${pad(m)}-${pad(b)}` : `${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`;
        try {
          have[key] = await fetchGoogleNews(t.q, after, before, 'en');
        } catch (e) {
          console.log(t.id, key, 'ERR', (e as Error).message.slice(0, 60));
          await sleep(5000);
        }
        await sleep(350);
      }
      fs.writeFileSync(f, JSON.stringify(have));
      if (++m > 12) { m = 1; y++; }
    }
    const n = Object.values(have).reduce((s, x) => s + x.length, 0);
    console.log(`${t.id}: ${Object.keys(have).length} windows, ${n} headlines`);
  }
})();
