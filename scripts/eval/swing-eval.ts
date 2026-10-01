/**
 * Swing engine on REAL hourly data (run scripts/eval/fetch-real.ts once first).
 *
 * Protocol, fixed before any tuning so the numbers can't be massaged after the fact:
 *  • 90-day windows (the production maximum), stepping 15 days, per coin and preset
 *  • DEV  = windows ending in the first half of the year — the only data used while designing
 *  • HOLD = windows starting in the second half — looked at once, to report, never to tune
 * Results are in USD terms (the coin edge itself); the cash alternative is tether at 0%.
 *
 * Run: npx tsx scripts/eval/swing-eval.ts [v1|v2|both] [dev|hold|all]
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSwing, type SwingBar, type SwingPreset } from '@/lib/engine/swing';
import { CACHE, BASKET } from './fetch-real';
import type { Candle } from '@/lib/sources/klines';

const H = 3600_000;
const WIN = 90 * 24;
const STEP = 15 * 24;
const WARM = 552;

export function loadDaily1d(sym: string): Candle[] | null {
  const f = path.join(CACHE, `daily1d-${sym}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function loadCandles(sym: string): Candle[] | null {
  const f = path.join(CACHE, `hourly-${sym}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export interface Row { sym: string; preset: SwingPreset; split: 'dev' | 'hold'; ret: number; hold: number; trades: number; dd: number; pf: number | null; win: number | null; sharpe: number | null }

export function evaluate(engine: 'v1' | 'v2', split: 'dev' | 'hold' | 'all', presets: SwingPreset[] = ['trend', 'calm', 'normal', 'aggressive'], useDaily = true): Row[] {
  const rows: Row[] = [];
  const btc = loadCandles('BTC')!;
  const btcD = (loadDaily1d('BTC') ?? []).map((k) => ({ t: k.t, p: k.c }));
  for (const sym of BASKET) {
    const c = loadCandles(sym);
    if (!c) continue;
    const dly = (loadDaily1d(sym) ?? []).map((k) => ({ t: k.t, p: k.c }));
    const mid = c[Math.floor(c.length / 2)].t;
    // windows start after a 23-day warm-up so v2 can be given the history production will fetch;
    // v1 trades the same 90 days without it, exactly as it does in production today
    for (let s = WARM; s + WIN <= c.length; s += STEP) {
      const win = c.slice(s, s + WIN);
      const withWarm = c.slice(s - WARM, s + WIN);
      const sp: 'dev' | 'hold' = win[win.length - 1].t <= mid ? 'dev' : win[0].t >= mid ? 'hold' : ('skip' as any);
      if ((sp as string) === 'skip' || (split !== 'all' && sp !== split)) continue;
      const bars: SwingBar[] = engine === 'v1' ? win.map((k) => ({ t: k.t, p: k.c })) : withWarm.map((k) => ({ t: k.t, p: k.c, o: k.o, h: k.h, l: k.l, v: k.v }));
      const ctxBtc = engine === 'v2' && sym !== 'BTC' ? btc.filter((k) => k.t >= withWarm[0].t && k.t <= win[win.length - 1].t).map((k) => ({ t: k.t, p: k.c })) : undefined;
      for (const preset of presets) {
        const r = runSwing(bars, { id: sym, symbol: sym, name: sym }, { capitalToman: 1e8, preset, feePct: Number(process.env.FEE ?? 0.4), usdtRial: null, engine, market: ctxBtc, tradeFrom: win[0].t, daily: useDaily ? dly.filter((d) => d.t < win[win.length - 1].t) : null, marketDaily: useDaily && sym !== 'BTC' ? btcD.filter((d) => d.t < win[win.length - 1].t) : null });
        const m = r.metrics;
        rows.push({ sym, preset, split: sp, ret: m.returnPct, hold: m.buyHoldPct, trades: m.trades, dd: m.maxDrawdownPct, pf: m.profitFactor, win: m.winRatePct, sharpe: m.sharpe });
      }
    }
  }
  return rows;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export function summarize(label: string, rows: Row[]) {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.preset, [...(by.get(r.preset) ?? []), r]);
  by.set('ALL', rows);
  for (const [k, rs] of by) {
    const allTrades = rs.reduce((a, r) => a + r.trades, 0);
    console.log(
      `${label.padEnd(10)} ${k.padEnd(10)} n=${String(rs.length).padStart(3)} ret avg ${avg(rs.map((r) => r.ret)).toFixed(2).padStart(6)}% med ${med(rs.map((r) => r.ret)).toFixed(2).padStart(6)}%` +
        ` | >0 ${((rs.filter((r) => r.ret > 0).length / rs.length) * 100).toFixed(0).padStart(3)}%` +
        ` | beatHold ${((rs.filter((r) => r.ret > r.hold).length / rs.length) * 100).toFixed(0).padStart(3)}% (hold avg ${avg(rs.map((r) => r.hold)).toFixed(1)}%)` +
        ` | DD avg ${avg(rs.map((r) => r.dd)).toFixed(1)}% | trades/win ${(allTrades / rs.length).toFixed(1)} | win% ${avg(rs.filter((r) => r.win !== null).map((r) => r.win!)).toFixed(0)}`,
    );
  }
}

if (process.argv[1]?.endsWith('swing-eval.ts')) {
  const which = (process.argv[2] ?? 'v1') as 'v1' | 'v2' | 'both';
  const split = (process.argv[3] ?? 'dev') as 'dev' | 'hold' | 'all';
  for (const e of which === 'both' ? (['v1', 'v2'] as const) : [which]) summarize(`${e}/${split}`, evaluate(e, split));
}
