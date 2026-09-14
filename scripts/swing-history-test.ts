/** Priors must inform the scan without being able to overrule the current data. */
import assert from 'node:assert';
import { buildPriors, PRIOR_WEIGHT, type SwingRunRecord } from '@/lib/swing-history';
import { scanSwing } from '@/lib/engine/swing-scan';
import type { SwingBar } from '@/lib/engine/swing';

const rec = (coinId: string, symbol: string, returnPct: number, buyHoldPct: number, i = 0): SwingRunRecord => ({
  at: Date.now() - i * 1000, source: 'scan', coinId, symbol, preset: 'normal', days: 90, feePct: 0.4,
  returnPct, buyHoldPct, trades: 10, winRatePct: 50, maxDrawdownPct: -8, from: i, to: i + 1,
});

// ── 1. the prior measures EDGE over buy & hold, not raw return ──
// "lucky" made 40% while simply holding made 60% — it was a bad swing vehicle despite the big number.
const priors = buildPriors([rec('lucky', 'LUCKY', 40, 60), rec('real', 'REAL', 8, -5)]);
assert.ok(priors.get('real')!.score > priors.get('lucky')!.score, 'edge over buy&hold must drive the prior, not raw return');
assert.ok(priors.get('lucky')!.score < 0, 'underperforming buy&hold must score negative');
console.log(`edge-based prior OK (real ${priors.get('real')!.score.toFixed(3)} > lucky ${priors.get('lucky')!.score.toFixed(3)})`);

// ── 2. evidence shrinkage: more runs ⇒ stronger opinion, never beyond the cap ──
const one = buildPriors([rec('x', 'X', 30, 0)]).get('x')!;
const many = buildPriors(Array.from({ length: 20 }, (_, i) => rec('x', 'X', 30, 0, i))).get('x')!;
assert.ok(Math.abs(many.score) > Math.abs(one.score), 'more runs must carry more weight');
assert.ok(Math.abs(many.score) <= 1, 'score stays within ±1');
assert.ok(Math.abs(one.score) <= 0.25, `a single run must stay near "no opinion", got ${one.score}`);
console.log(`shrinkage OK (1 run ${one.score.toFixed(3)}, 20 runs ${many.score.toFixed(3)})`);

// ── 3. the prior can reorder near-ties but cannot overrule a clear data gap ──
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const H = 3600_000, T0 = Date.UTC(2026, 0, 1);
const mk = (drift: number, vol: number): SwingBar[] => {
  let p = 100; const out: SwingBar[] = [];
  for (let i = 0; i < 1600; i++) { p *= Math.exp(drift + vol * g()); out.push({ t: T0 + i * H, p }); }
  return out;
};
const strong = mk(0.0009, 0.008);   // clearly better in the current window
const weak = mk(-0.0006, 0.009);    // clearly worse
const cfg = { preset: 'normal' as const, feePct: 0.4, usdtRial: 1e7, capitalToman: 1e8 };
const C = (id: string) => ({ id, symbol: id.toUpperCase(), name: id });

// give WEAK the best possible history and STRONG the worst
const hostile = buildPriors([
  ...Array.from({ length: 20 }, (_, i) => rec('weak', 'WEAK', 50, 0, i)),
  ...Array.from({ length: 20 }, (_, i) => rec('strong', 'STRONG', -50, 0, i + 100)),
]);
const noPrior = scanSwing([{ coin: C('strong'), bars: strong }, { coin: C('weak'), bars: weak }], cfg, 1);
const withPrior = scanSwing([{ coin: C('strong'), bars: strong }, { coin: C('weak'), bars: weak }], cfg, 1, hostile);
const gap = Math.abs(noPrior.candidates[0].inSample!.score - noPrior.candidates[1].inSample!.score);
console.log(`data gap ${gap.toFixed(2)} vs max prior swing ${(2 * PRIOR_WEIGHT).toFixed(2)}`);
if (gap > 2 * PRIOR_WEIGHT) {
  assert.equal(withPrior.selected[0].coin.id, noPrior.selected[0].coin.id,
    'a hostile prior must not flip a selection the current data decides clearly');
  console.log('prior cannot overrule a clear data gap OK');
} else {
  console.log('(data gap smaller than the prior cap — the prior is allowed to decide this tie)');
}

// ── 4. the adjustment is reported, so the ranking stays explainable ──
const shown = withPrior.candidates.find((c) => c.coin.id === 'weak')!;
assert.ok(shown.prior && shown.prior.runs === 20, 'prior must be attached to the candidate');
assert.ok(Math.abs(shown.prior!.adjustment) <= PRIOR_WEIGHT + 1e-9, 'adjustment must respect the cap');
console.log(`adjustment reported OK (${shown.prior!.adjustment.toFixed(3)})`);

// ── 5. no history ⇒ behaves exactly as before ──
const empty = scanSwing([{ coin: C('strong'), bars: strong }, { coin: C('weak'), bars: weak }], cfg, 1, new Map());
assert.equal(empty.selected[0].coin.id, noPrior.selected[0].coin.id, 'empty history must not change anything');
assert.ok(empty.candidates.every((c) => !c.prior), 'no prior attached when there is no history');
console.log('empty history is a no-op OK');

console.log('\nSWING HISTORY OK');
