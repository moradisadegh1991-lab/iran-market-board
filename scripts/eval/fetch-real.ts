/**
 * Downloads REAL market history once and caches it under .cache/eval (git-ignored), so the
 * evaluation scripts run offline and deterministically afterwards. Run: npx tsx scripts/eval/fetch-real.ts
 *  • hourly OHLCV, ~1 year, for a basket of coins tradable on Iranian exchanges (Binance public data)
 *  • full TGJU daily history: free-market dollar, Emami coin, 18k gold, ounce, tether (rial)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchDailyCandles, fetchHourlyCandles } from '@/lib/sources/klines';
import { fetchJson } from '@/lib/http';
import { num } from '@/lib/num';

export const CACHE = path.join(process.cwd(), '.cache/eval');
export const BASKET = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'TON', 'BNB', 'ADA', 'LINK', 'AVAX', 'TRX', 'LTC', 'DOT', 'SHIB'];
export const TGJU = { usd: 'price_dollar_rl', coin: 'sekee', g18: 'geram18', ons: 'ons', usdt: 'crypto-tether-irr', nim: 'nim', rob: 'rob' } as const;

async function tgjuAll(slug: string): Promise<[string, number][]> {
  const json: any = await fetchJson(`https://api.tgju.org/v1/market/indicator/summary-table-data/${slug}`, { timeoutMs: 30_000 });
  const out = new Map<string, number>();
  for (const row of json?.data ?? []) {
    const close = num(String(row[3]).replace(/<[^>]+>/g, ''));
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(row[6]).replace(/<[^>]+>/g, '').trim());
    if (m && close > 0) out.set(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, close);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [k, slug] of Object.entries(TGJU)) {
    if (fs.existsSync(path.join(CACHE, `daily-${k}.json`)) && !process.argv.includes('--refresh')) continue;
    const rows = await tgjuAll(slug);
    fs.writeFileSync(path.join(CACHE, `daily-${k}.json`), JSON.stringify(rows));
    console.log(`daily ${k}: ${rows.length} rows ${rows[0]?.[0]} → ${rows.at(-1)?.[0]}`);
  }
  for (const sym of BASKET) {
    try {
      const d = await fetchDailyCandles(sym, 999);
      fs.writeFileSync(path.join(CACHE, `daily1d-${sym}.json`), JSON.stringify(d));
      console.log(`daily candles ${sym}: ${d.length}`);
    } catch (e) {
      console.log(`daily candles ${sym}: FAILED ${(e as Error).message}`);
    }
    if (fs.existsSync(path.join(CACHE, `hourly-${sym}.json`)) && !process.argv.includes('--refresh')) continue;
    try {
      const { candles, via } = await fetchHourlyCandles(sym, 24 * 365);
      fs.writeFileSync(path.join(CACHE, `hourly-${sym}.json`), JSON.stringify(candles));
      console.log(`hourly ${sym}: ${candles.length} via ${via}`);
    } catch (e) {
      console.log(`hourly ${sym}: FAILED ${(e as Error).message}`);
    }
  }
}

if (process.argv[1]?.endsWith('fetch-real.ts')) main();
