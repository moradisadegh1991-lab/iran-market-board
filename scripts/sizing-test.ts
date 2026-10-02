// Checks for the position sizer. Every number here is verified against an independently
// computed expectation, not against whatever the function happened to return.
import assert from 'node:assert';
import { lossesToDrawdown, sizePosition } from '../lib/engine/sizing';

const near = (a: number, b: number, tol = 1e-6, what = '') =>
  assert.ok(Math.abs(a - b) < tol, `${what}: expected ${b}, got ${a}`);

// ── 1. the core rule: risk is fixed, the stop distance decides the quantity ──
// 100m toman, risk 1% = 1m toman. Entry 1000, stop 950, no fees → 50 lost per unit → 20,000 units.
const clean = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 950,
  feePctPerSide: 0, maxPositionPct: 100,
});
assert.ok(clean.ok, clean.reason);
near(clean.lossPerUnit, 50, 1e-9, 'loss per unit');
near(clean.qty, 20_000, 1e-6, 'quantity');
near(clean.riskToman, 1_000_000, 1e-6, 'money at risk');
near(clean.positionToman, 20_000_000, 1e-6, 'position size');
near(clean.stopDistancePct, 5, 1e-9, 'stop distance');
console.log('core sizing rule OK');

// ── 2. a tighter stop must give a BIGGER position at the SAME risk ──
const tight = sizePosition({ ...{ capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, feePctPerSide: 0, maxPositionPct: 100 }, stopPrice: 975 });
assert.ok(tight.positionToman > clean.positionToman * 1.9, 'halving the stop distance must roughly double the position');
near(tight.riskToman, clean.riskToman, 1e-6, 'but the money at risk must not move');
console.log('tight stop → bigger position, same risk OK');

// ── 3. costs are charged on both legs, so the real loss exceeds the chart distance ──
const withFee = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 950,
  feePctPerSide: 0.4, maxPositionPct: 100,
});
// buy at 1000×1.004 = 1004, stop fills at 950×0.996 = 946.2 → 57.8 lost per unit, not 50
near(withFee.lossPerUnit, 1004 - 946.2, 1e-9, 'loss per unit with fees');
assert.ok(withFee.qty < clean.qty, 'costs must shrink the position, not be ignored');
near(withFee.riskToman, 1_000_000, 1e-6, 'the money at risk is still exactly the budget');
console.log(`cost-aware sizing OK — a 5.0% stop really costs ${(withFee.lossPerUnit / 1000 * 100).toFixed(2)}% of entry`);

// ── 4. the position cap must bite, and must say that it did ──
const capped = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 2, entryPrice: 1000, stopPrice: 995,
  feePctPerSide: 0, maxPositionPct: 25,
});
assert.equal(capped.cappedBy, 'position', 'a 0.5% stop at 2% risk needs 400% of capital — the cap must engage');
near(capped.positionToman, 25_000_000, 1e-6, 'capped position');
assert.ok(capped.riskPct < 2, 'and the realised risk must be reported as lower than requested');
assert.ok(capped.warnings.some((w) => w.includes('سقف')), 'the user must be told the cap decided the size');
console.log(`position cap OK — requested 2% risk, actually ${capped.riskPct.toFixed(3)}%`);

// ── 5. R multiple and the break-even win rate it implies ──
const withTarget = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 900, targetPrice: 1200,
  feePctPerSide: 0, maxPositionPct: 100,
});
near(withTarget.rMultiple!, 2, 1e-9, 'R multiple'); // +200 up vs −100 down
near(withTarget.breakEvenWinRatePct!, 100 / 3, 1e-9, 'break-even win rate at 2R');
const poorRr = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 900, targetPrice: 1050,
  feePctPerSide: 0, maxPositionPct: 100,
});
near(poorRr.rMultiple!, 0.5, 1e-9, 'poor R multiple');
assert.ok(poorRr.warnings.some((w) => w.includes('نسبت سود به زیان')), 'a bad reward:risk must be called out');
console.log('R multiple & break-even win rate OK');

// ── 6. Kelly: a real edge sizes up, a negative edge must refuse outright ──
const edgeOk = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 950,
  feePctPerSide: 0, maxPositionPct: 100, edge: { winRatePct: 55, payoffRatio: 1.5 },
});
// f* = 0.55 − 0.45/1.5 = 0.25
near(edgeOk.kelly!.fullPct, 25, 1e-9, 'full Kelly');
near(edgeOk.kelly!.halfPct, 12.5, 1e-9, 'half Kelly');
assert.ok(edgeOk.kelly!.verdict.includes('محافظه‌کارانه'), '1% risk against a 12.5% half-Kelly is conservative');

const edgeBad = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 950,
  feePctPerSide: 0, maxPositionPct: 100, edge: { winRatePct: 35, payoffRatio: 1.0 },
});
// f* = 0.35 − 0.65/1 = −0.30
assert.ok(edgeBad.kelly!.fullPct < 0, 'a losing edge must produce a negative Kelly fraction');
assert.ok(edgeBad.kelly!.verdict.includes('اصلاً نباید'), 'and must say the trade should not be taken');
assert.ok(edgeBad.warnings.some((w) => w.includes('امید ریاضی')), 'negative expectancy must be a warning');
console.log('Kelly cross-check OK');

// ── 7. a stop inside the asset's normal noise must be flagged ──
// BTC-like: 60% annual vol, 5-day trade → typical move ≈ 60×√(5/365) ≈ 7.0%
const noisy = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 985,
  feePctPerSide: 0, maxPositionPct: 100, annualVolPct: 60, holdDays: 5,
});
near(noisy.stopVsNoise!.expectedMovePct, 60 * Math.sqrt(5 / 365), 1e-9, 'expected move');
assert.ok(noisy.stopVsNoise!.ratio < 0.7, 'a 1.5% stop is well inside a 7% noise band');
assert.ok(noisy.stopVsNoise!.verdict.includes('نوسان عادی'), 'and must be described as such');

const sane = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 900,
  feePctPerSide: 0, maxPositionPct: 100, annualVolPct: 60, holdDays: 5,
});
assert.ok(sane.stopVsNoise!.ratio >= 0.7 && sane.stopVsNoise!.ratio <= 3, 'a 10% stop against 7% noise is proportionate');
assert.ok(sane.stopVsNoise!.verdict.includes('متناسب'));
console.log(`stop-vs-noise check OK (5-day noise band for a 60%-vol asset is ${noisy.stopVsNoise!.expectedMovePct.toFixed(1)}%)`);

// ── 8. simultaneous risk across open positions ──
const stacked = sizePosition({
  capitalToman: 100_000_000, riskPctPerTrade: 2, entryPrice: 1000, stopPrice: 900,
  feePctPerSide: 0, maxPositionPct: 100, openRiskPct: 5,
});
assert.ok(stacked.warnings.some((w) => w.includes('هم‌جهت')), 'stacked correlated risk must be warned about');
console.log('open-risk stacking OK');

// ── 9. bad inputs are refused with a reason, never silently sized ──
for (const [bad, why] of [
  [{ stopPrice: 1100 }, 'stop above entry'],
  [{ stopPrice: 1000 }, 'stop equal to entry'],
  [{ entryPrice: 0 }, 'zero entry'],
  [{ capitalToman: 0 }, 'zero capital'],
] as const) {
  const valid = { capitalToman: 100_000_000, riskPctPerTrade: 1, entryPrice: 1000, stopPrice: 950, feePctPerSide: 0 };
  const r = sizePosition({ ...valid, ...bad });
  assert.equal(r.ok, false, `${why} must be refused`);
  assert.ok(r.reason && r.reason.length > 0, `${why} must come with an explanation`);
  assert.equal(r.qty, 0, `${why} must not produce a quantity`);
}
console.log('input validation OK');

// ── 10. losing streak → drawdown, checked against direct compounding ──
assert.equal(lossesToDrawdown(1, 20), Math.ceil(Math.log(0.8) / Math.log(0.99)));
assert.equal(lossesToDrawdown(1, 20), 23);
assert.equal(lossesToDrawdown(5, 20), 5);
// verify by actually compounding
let eq = 1;
let n = 0;
while (eq > 0.8) { eq *= 0.99; n++; }
assert.equal(n, lossesToDrawdown(1, 20), 'must match straight compounding');
console.log(`streak math OK — at 1% risk it takes ${lossesToDrawdown(1, 20)} losses in a row to be down 20%, at 5% only ${lossesToDrawdown(5, 20)}`);

console.log('\nSIZING OK');
