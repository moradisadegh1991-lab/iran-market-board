/**
 * FINAL TEST — the two years before the dev year (Oct 2023 → Sep 2025, incl. the 2024 bull market),
 * never used while designing v2. Same 90-day windows as swing-eval.ts. Daily closes for the regime
 * filter are aggregated from the hourly candles (UTC days, closed days only).
 * Run: npx tsx scripts/eval/swing-final.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSwing, type SwingBar, type SwingPreset } from '@/lib/engine/swing';
import { BASKET, CACHE } from './fetch-real';
import { summarize, type Row } from './swing-eval';
import type { Candle } from '@/lib/sources/klines';

const WIN = 90 * 24, STEP = 15 * 24, WARM = 552, DAY = 86_400_000;
const load = (s: string): Candle[] | null => { const f = path.join(CACHE, `hourly-old-${s}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
function toDaily(c: Candle[]): SwingBar[] {
  const m = new Map<number, number>();
  for (const k of c) m.set(Math.floor(k.t / DAY) * DAY, k.c); // last close of each UTC day
  return [...m.entries()].map(([t, p]) => ({ t, p }));
}
const btc = load('BTC')!; const btcD = toDaily(btc);
const rows: Record<'v1' | 'v2', Row[]> = { v1: [], v2: [] };
for (const sym of BASKET) {
  const c = load(sym); if (!c) continue;
  const d = toDaily(c);
  for (let s = WARM; s + WIN <= c.length; s += STEP) {
    const win = c.slice(s, s + WIN), ww = c.slice(s - WARM, s + WIN), end = win[WIN - 1].t;
    for (const preset of ['trend', 'calm', 'normal', 'aggressive'] as SwingPreset[]) {
      for (const engine of ['v1', 'v2'] as const) {
        const bars = engine === 'v1' ? win.map((k) => ({ t: k.t, p: k.c })) : ww.map((k) => ({ t: k.t, p: k.c, o: k.o, h: k.h, l: k.l, v: k.v }));
        const r = runSwing(bars, { id: sym, symbol: sym, name: sym }, {
          capitalToman: 1e8, preset, feePct: 0.4, usdtRial: null, engine, tradeFrom: win[0].t,
          market: engine === 'v2' && sym !== 'BTC' ? btc.filter((k) => k.t >= ww[0].t && k.t <= end).map((k) => ({ t: k.t, p: k.c })) : null,
          daily: d.filter((x) => x.t + DAY <= end), marketDaily: sym !== 'BTC' ? btcD.filter((x) => x.t + DAY <= end) : null,
        });
        const m = r.metrics;
        rows[engine].push({ sym, preset, split: 'hold', ret: m.returnPct, hold: m.buyHoldPct, trades: m.trades, dd: m.maxDrawdownPct, pf: m.profitFactor, win: m.winRatePct, sharpe: m.sharpe });
      }
    }
  }
}
summarize('v1/final', rows.v1);
summarize('v2/final', rows.v2);
