/**
 * Real data for the crypto coin-selection and futures studies, cached under .cache/eval (git-ignored):
 *   daily-long/<SYM>.json   daily OHLCV from Binance spot (data-api.binance.vision) since listing
 *   funding/<SYM>-YYYY-MM.csv   USDⓈ-M perpetual funding settlements (data.binance.vision), from 2020-01
 * The universe deliberately includes coins that collapsed or faded (FTT, LUNA, EOS, AXS, …): a study of
 * "which coins to trade" that only looks at today's survivors flatters every rule (survivorship bias).
 * Run: npx tsx scripts/eval/fetch-futures.ts          (~5 minutes; re-run skips what is cached)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CACHE } from './fetch-real';

/** spot symbol (base) → perpetual symbol on Binance USDⓈ-M */
export const UNIVERSE: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', BNB: 'BNBUSDT', SOL: 'SOLUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT',
  TRX: 'TRXUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT', DOT: 'DOTUSDT', LTC: 'LTCUSDT', BCH: 'BCHUSDT', XLM: 'XLMUSDT',
  ETC: 'ETCUSDT', ATOM: 'ATOMUSDT', NEAR: 'NEARUSDT', UNI: 'UNIUSDT', FIL: 'FILUSDT', ICP: 'ICPUSDT', AAVE: 'AAVEUSDT',
  HBAR: 'HBARUSDT', APT: 'APTUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT', SUI: 'SUIUSDT', INJ: 'INJUSDT', SHIB: '1000SHIBUSDT',
  PEPE: '1000PEPEUSDT', TON: 'TONUSDT',
  // faded or collapsed — kept so the selection study sees losers too
  FTT: 'FTTUSDT', LUNA: 'LUNAUSDT', EOS: 'EOSUSDT', XTZ: 'XTZUSDT', THETA: 'THETAUSDT', VET: 'VETUSDT', ALGO: 'ALGOUSDT',
  SAND: 'SANDUSDT', MANA: 'MANAUSDT', AXS: 'AXSUSDT',
};
/** old LUNA traded until the May-2022 collapse; the same ticker was later reused for a new coin */
export const CUTOFF: Record<string, number> = { LUNA: Date.parse('2022-05-13') };

const LONG = path.join(CACHE, 'daily-long');
const FUND = path.join(CACHE, 'funding');

async function get(url: string, tries = 4): Promise<Response | null> {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) return null;
      if (r.ok) return r;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** k));
  }
  throw new Error(`failed: ${url}`);
}

async function daily(sym: string): Promise<void> {
  const f = path.join(LONG, `${sym}.json`);
  if (fs.existsSync(f) && !process.argv.includes('--refresh')) return;
  const pair = sym === 'SHIB' ? 'SHIBUSDT' : sym === 'PEPE' ? 'PEPEUSDT' : `${sym}USDT`;
  const out = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
  let start = Date.parse('2017-08-01');
  for (let i = 0; i < 12; i++) {
    const r = await get(`https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&startTime=${start}`);
    const rows = r ? ((await r.json()) as unknown[][]) : [];
    if (!rows.length) break;
    for (const k of rows) out.set(+k[0]!, { t: +k[0]!, o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[7]! });
    start = +rows[rows.length - 1][0]! + 86_400_000;
    if (rows.length < 1000) break;
  }
  const cut = CUTOFF[sym];
  const rows = [...out.values()].filter((b) => !cut || b.t < cut).sort((a, b) => a.t - b.t);
  fs.writeFileSync(f, JSON.stringify(rows));
  console.log(`daily ${sym}: ${rows.length} days from ${new Date(rows[0]?.t ?? 0).toISOString().slice(0, 10)}`);
}

async function fundingMonths(sym: string, perp: string): Promise<void> {
  const now = new Date();
  let got = 0;
  for (let y = 2020; y <= now.getUTCFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === now.getUTCFullYear() && m >= now.getUTCMonth() + 1) break;
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const csv = path.join(FUND, `${sym}-${ym}.csv`);
      if (fs.existsSync(csv) || fs.existsSync(`${csv}.none`)) continue;
      const r = await get(`https://data.binance.vision/data/futures/um/monthly/fundingRate/${perp}/${perp}-fundingRate-${ym}.zip`);
      if (!r) {
        fs.writeFileSync(`${csv}.none`, '');
        continue;
      }
      const zip = path.join(FUND, `${sym}-${ym}.zip`);
      fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
      const text = execFileSync('unzip', ['-p', zip], { encoding: 'utf8' });
      fs.writeFileSync(csv, text);
      fs.unlinkSync(zip);
      got++;
    }
  }
  if (got) console.log(`funding ${sym}: ${got} months`);
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let x = q.shift(); x !== undefined; x = q.shift()) {
      try {
        await fn(x);
      } catch (e) {
        console.log(String((e as Error).message));
      }
    }
  }));
}

async function main() {
  fs.mkdirSync(LONG, { recursive: true });
  fs.mkdirSync(FUND, { recursive: true });
  await pool(Object.keys(UNIVERSE), 4, daily);
  await pool(Object.entries(UNIVERSE), 6, ([s, p]) => fundingMonths(s, p));
}

if (process.argv[1]?.endsWith('fetch-futures.ts')) main();
