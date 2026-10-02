/** The two years BEFORE the dev year, as an untouched final test set. Run once: npx tsx scripts/eval/fetch-old.ts */
import fs from 'node:fs';
import path from 'node:path';
import { fetchHourlyCandles } from '@/lib/sources/klines';
import { BASKET, CACHE } from './fetch-real';
import type { Candle } from '@/lib/sources/klines';

async function main() {
  for (const sym of BASKET) {
    const f = path.join(CACHE, `hourly-old-${sym}.json`);
    if (fs.existsSync(f)) continue;
    const cur: Candle[] = JSON.parse(fs.readFileSync(path.join(CACHE, `hourly-${sym}.json`), 'utf8'));
    const end = cur[0].t;
    try {
      const a = await fetchHourlyCandles(sym, 8760, end);
      const b = await fetchHourlyCandles(sym, 8760, a.candles[0].t);
      const all = [...b.candles, ...a.candles].filter((x, i, arr) => i === 0 || x.t > arr[i - 1].t);
      fs.writeFileSync(f, JSON.stringify(all));
      console.log(`old ${sym}: ${all.length} ${new Date(all[0].t).toISOString().slice(0, 10)} → ${new Date(all[all.length - 1].t).toISOString().slice(0, 10)}`);
    } catch (e) {
      console.log(`old ${sym}: FAILED ${(e as Error).message}`);
    }
  }
}
main();
