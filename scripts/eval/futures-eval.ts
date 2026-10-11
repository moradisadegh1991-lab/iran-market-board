/**
 * What leverage does to the trend rider on perpetual futures — real daily candles, real Binance funding
 * (2020→2026), liquidation against each day's low/high (lib/engine/futures.ts). Design 2020–2022, test
 * 2023–2026; nothing here is tuned — the trend rule is the spot engine's, the sizing the same.
 * Per coin and leverage: CAGR, max drawdown, liquidations, funding and fees paid, and whether the account
 * was wiped out. Also long-only vs long+short.
 * Run: npx tsx scripts/eval/futures-eval.ts      (needs scripts/eval/fetch-futures.ts first)
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './fetch-real';
import { loadDaily } from './coin-pick-eval';
import { maxLeverage, runFuturesTrend, type FuturesMode } from '@/lib/engine/futures';

const DAY = 86_400_000;
/** sum of the day's settlements ÷ 3 = the per-8h rate the engine applies three times a day */
export function fundingByDay(sym: string): Map<number, number> {
  const dir = path.join(CACHE, 'funding');
  const acc = new Map<number, number>();
  if (!fs.existsSync(dir)) return acc;
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(`${sym}-`) && x.endsWith('.csv'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(1)) {
      const [t, , r] = line.split(',');
      if (!t || !r || !Number.isFinite(+r)) continue;
      const d = Math.floor(+t / DAY) * DAY;
      acc.set(d, (acc.get(d) ?? 0) + +r);
    }
  }
  return new Map([...acc].map(([d, s]) => [d, s / 3]));
}

const PERIODS = { design: [Date.parse('2020-01-01'), Date.parse('2022-12-31')], test: [Date.parse('2023-01-01'), Date.parse('2026-09-30')] } as const;
const LEVS = [1, 2, 3, 5, 10, 20, 50, 100, 125];
const SIZING = (process.argv.includes('--exposure') ? 'exposure' : 'margin') as 'margin' | 'exposure';
const COINS = (process.argv.find((a) => a.startsWith('--coins='))?.slice(8) ?? 'BTC,ETH,TRX,LTC,BNB,SOL,XRP,DOGE').split(',');
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? '   —' : `${x >= 0 ? '+' : ''}${x.toFixed(0)}%`);

function main() {
  const btc = loadDaily('BTC');
  const rows: { sym: string; mode: FuturesMode; lev: number; per: string; cagr: number | null; dd: number; liq: number; ruined: boolean; fund: number; fees: number }[] = [];
  for (const mode of ['long', 'longshort'] as FuturesMode[]) {
    console.log(`\n== mode: ${mode} ==   (capital 1000 USDT; CAGR / max drawdown / liquidations; ✗ = account wiped out)`);
    console.log(`${'coin'.padEnd(6)} ${'per'.padEnd(6)} ${LEVS.map((l) => `${l}×`.padStart(22)).join('')}`);
    for (const sym of COINS) {
      const bars = loadDaily(sym);
      if (!bars.length) continue;
      const f = fundingByDay(sym);
      for (const [per, [from, to]] of Object.entries(PERIODS)) {
        const cells: string[] = [];
        for (const lev of LEVS) {
          if (lev > maxLeverage(sym)) {
            cells.push('n/a'.padStart(22));
            continue;
          }
          const r = runFuturesTrend(bars, sym === 'BTC' ? null : btc, { sym, lev, mode, capital: 1000, fundingByDay: f, from, to, sizing: SIZING });
          rows.push({ sym, mode, lev, per, cagr: r.cagrPct, dd: r.maxDrawdownPct, liq: r.liquidations, ruined: r.ruined, fund: r.fundingPaid, fees: r.feesPaid });
          cells.push(`${pct(r.cagrPct)}/${pct(r.maxDrawdownPct)}/${r.liquidations}${r.ruined ? '✗' : ''}`.padStart(22));
        }
        console.log(`${sym.padEnd(6)} ${per.padEnd(6)} ${cells.join('')}`);
      }
    }
  }
  // summary: per leverage, over all coins and both periods
  console.log('\n== summary over the coins above, both periods ==');
  for (const mode of ['long', 'longshort'] as FuturesMode[]) {
    for (const lev of LEVS) {
      const r = rows.filter((x) => x.mode === mode && x.lev === lev);
      if (!r.length) continue;
      const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      console.log(
        `${mode.padEnd(9)} ${String(lev).padStart(3)}×  runs ${r.length}  median CAGR ${pct(med(r.map((x) => x.cagr ?? -100)))}  median DD ${pct(med(r.map((x) => x.dd)))}` +
          `  liquidations ${r.reduce((a, x) => a + x.liq, 0)}  wiped out ${r.filter((x) => x.ruined).length}/${r.length}` +
          `  funding paid ${Math.round(r.reduce((a, x) => a + x.fund, 0))} fees ${Math.round(r.reduce((a, x) => a + x.fees, 0))} USDT`,
      );
    }
  }
  if (process.argv.includes('--json')) fs.writeFileSync(path.join(CACHE, 'futures-eval.json'), JSON.stringify(rows));
}

if (process.argv[1]?.endsWith('futures-eval.ts')) main();
