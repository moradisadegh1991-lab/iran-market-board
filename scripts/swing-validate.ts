import { runSwing, type SwingBar } from '@/lib/engine/swing';

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const H = 3600_000;

function bars(n: number, gen: (i: number, prev: number) => number): SwingBar[] {
  const out: SwingBar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) { p = gen(i, p); out.push({ t: Date.now() - (n - 1 - i) * H, p }); }
  return out;
}

const coin = { id: 'test', symbol: 'TST', name: 'تست' };
const cfg = { capitalToman: 1e9, preset: 'normal' as const, feePct: 0.4, usdtRial: 1e7 };

// A) mean-reverting oscillation, no drift — the regime swing trading is FOR
const meanRev = bars(1800, (i, prev) => {
  const anchor = 100;
  return prev + (anchor - prev) * 0.02 + anchor * 0.008 * gauss();
});
// B) strong persistent uptrend, low noise — the regime buy&hold should WIN
const trend = bars(1800, (_, prev) => prev * Math.exp(0.0006 + 0.006 * gauss()));
// C) pure random walk, no drift — expect roughly break-even minus costs
const walk = bars(1800, (_, prev) => prev * Math.exp(0.008 * gauss()));

for (const [name, b] of [['mean-reverting', meanRev], ['strong uptrend', trend], ['random walk', walk]] as const) {
  const r = runSwing(b, coin, cfg);
  const m = r.metrics;
  const verdict = m.returnPct > m.buyHoldPct ? 'BEATS hold' : 'loses to hold';
  console.log(`${name.padEnd(15)} trades=${String(m.trades).padStart(3)} ret=${m.returnPct.toFixed(1).padStart(7)}% hold=${m.buyHoldPct.toFixed(1).padStart(7)}% win=${(m.winRatePct ?? 0).toFixed(0).padStart(3)}% DD=${m.maxDrawdownPct.toFixed(1).padStart(6)}% ${verdict}`);
}

// invariants that must hold regardless of regime
const r = runSwing(meanRev, coin, cfg);
const errs: string[] = [];
if (r.trades.some((t) => t.exitAt <= t.entryAt)) errs.push('trade exits before it enters');
if (r.trades.some((t) => t.qty <= 0)) errs.push('non-positive quantity');
if (r.trades.some((t) => t.feeToman <= 0)) errs.push('a trade paid no fee');
if (r.equity.some((e) => e.equity < 0)) errs.push('equity went negative (impossible: long-only, no leverage)');
// no two trades may overlap in time (single position only)
const sorted = [...r.trades].sort((a, b) => a.entryAt - b.entryAt);
for (let i = 1; i < sorted.length; i++) if (sorted[i].entryAt < sorted[i - 1].exitAt) errs.push('overlapping positions');
// stop exits must be at or below the stop price
if (r.trades.some((t) => t.exit === 'stop' && t.exitPrice > t.stopPrice * 1.0001)) errs.push('stop exit above stop price');
if (r.trades.some((t) => t.exit === 'target' && t.exitPrice < t.targetPrice * 0.9999)) errs.push('target exit below target price');
// final equity must equal start + sum of pnl
const sumPnl = r.trades.reduce((a, t) => a + t.pnlToman, 0);
if (Math.abs(r.metrics.finalEquity - (r.metrics.startEquity + sumPnl)) > 1) errs.push(`equity does not reconcile with trade P&L (${r.metrics.finalEquity} vs ${r.metrics.startEquity + sumPnl})`);
// a zero-fee run must beat the same run with fees
const noFee = runSwing(meanRev, coin, { ...cfg, feePct: 0 });
if (noFee.metrics.returnPct <= r.metrics.returnPct) errs.push('fees did not reduce the return');
console.log(errs.length ? 'INVARIANTS FAILED: ' + errs.join('; ') : 'INVARIANTS OK');
console.log(`fee sensitivity: 0% fee -> ${noFee.metrics.returnPct.toFixed(1)}%, 0.4% fee -> ${r.metrics.returnPct.toFixed(1)}%`);
