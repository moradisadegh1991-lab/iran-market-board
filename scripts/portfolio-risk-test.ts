// Offline checks for the portfolio tail-risk engine (lib/engine/portfolio-risk.ts).
// Synthetic series with KNOWN correlation and KNOWN tail shape, so every claim the engine
// makes about a portfolio can be checked against the number it should produce.
import assert from 'node:assert';
import { portfolioRisk, type SleeveInput } from '../lib/engine/portfolio-risk';
import { cornishFisher, varianceRatio } from '../lib/engine/stats';

/** deterministic uniform generator — the tests must not flake */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Box–Muller standard normal */
function normals(n: number, seed: number): number[] {
  const u = rng(seed);
  const out: number[] = [];
  while (out.length < n) {
    const a = Math.max(u(), 1e-12), b = u();
    const r = Math.sqrt(-2 * Math.log(a));
    out.push(r * Math.cos(2 * Math.PI * b));
    if (out.length < n) out.push(r * Math.sin(2 * Math.PI * b));
  }
  return out.slice(0, n);
}

const DAY = 86400000;
function seriesFrom(rets: number[], start = 1000): { dates: string[]; prices: number[] } {
  const dates: string[] = [];
  const prices: number[] = [start];
  const t0 = Date.parse('2024-01-01T00:00:00Z');
  dates.push(new Date(t0).toISOString().slice(0, 10));
  for (let i = 0; i < rets.length; i++) {
    prices.push(prices[prices.length - 1] * Math.exp(rets[i]));
    dates.push(new Date(t0 + (i + 1) * DAY).toISOString().slice(0, 10));
  }
  return { dates, prices };
}

const N = 400;

// ── 1. varianceRatio: a trending market travels further than √n ──
assert.equal(varianceRatio(0, 30), 1, 'no autocorrelation → plain √n scaling');
assert.ok(varianceRatio(0.3, 30) > 1.6, 'positive autocorrelation must inflate multi-day variance');
assert.ok(varianceRatio(-0.2, 30) < 1, 'mean reversion must deflate it');
console.log('varianceRatio OK');

// ── 2. cornishFisher: negative skew must push the 5% quantile further down ──
const zPlain = cornishFisher(-1.6449, 0, 0);
const zSkewed = cornishFisher(-1.6449, -0.8, 0);
assert.ok(Math.abs(zPlain + 1.6449) < 1e-9, 'with no skew/kurtosis it must reduce to the normal z');
assert.ok(zSkewed < zPlain, 'left-skewed returns must give a deeper 5% loss');
// Excess kurtosis deepens the quantile only past |z| = √3 (p ≈ 4.2%): the (z³−3z) term changes
// sign there. This is why a 95% VaR barely reacts to fat tails while expected shortfall — which
// averages the 0.5%–5% band — does. It is the reason the engine reports both.
assert.ok(cornishFisher(-2.5758, 0, 4) < cornishFisher(-2.5758, 0, 0), 'fat tails must deepen the 1% loss');
assert.ok(cornishFisher(-1.6449, 0, 4) > cornishFisher(-1.6449, 0, 0), 'at exactly 5% the kurtosis term pulls the quantile in');
console.log('cornishFisher OK');

// ── 3. independent sleeves diversify; identical sleeves do not ──
const a = normals(N, 11).map((z) => z * 0.01);
const b = normals(N, 77).map((z) => z * 0.01);
const sleeve = (key: string, weight: number, rets: number[]): SleeveInput => ({ key, weight, series: seriesFrom(rets) });

const independent = portfolioRisk([sleeve('a', 0.5, a), sleeve('b', 0.5, b)], 30, { annualVolPct: 99, varPct: 99 });
const identical = portfolioRisk([sleeve('a', 0.5, a), sleeve('b', 0.5, a)], 30, { annualVolPct: 99, varPct: 99 });

assert.equal(independent.basis, 'measured', 'with 400 days of history it must measure, not assume');
assert.ok(independent.avgCorrPct !== null && Math.abs(independent.avgCorrPct) < 15, `independent sleeves should measure near-zero correlation, got ${independent.avgCorrPct}`);
assert.ok(identical.avgCorrPct !== null && identical.avgCorrPct > 99, `identical sleeves must measure ~100% correlation, got ${identical.avgCorrPct}`);
assert.ok(
  identical.varPct! > independent.varPct! * 1.25,
  `perfectly correlated sleeves must carry clearly more risk (${identical.varPct} vs ${independent.varPct})`,
);
console.log('correlation measurement OK — this is the whole point: the assumed matrix cannot see this');

// ── 4. expected shortfall is always worse than VaR, and in the right ballpark for a normal ──
for (const r of [independent, identical]) {
  assert.ok(r.esPct! > r.varPct!, 'ES must exceed VaR — it averages the losses beyond it');
  assert.ok(r.esPct! < r.varPct! * 2, `ES should not be wildly beyond VaR for a near-normal book (${r.esPct} vs ${r.varPct})`);
}
// normal benchmark: ES₉₅/VaR₉₅ ≈ 1.2546
const ratio = independent.esPct! / independent.varPct!;
assert.ok(ratio > 1.1 && ratio < 1.5, `normal-ish returns should give ES/VaR near 1.25, got ${ratio.toFixed(3)}`);
console.log('expected shortfall OK');

// ── 5. a left-skewed, jumpy series must produce a deeper tail than a normal one of equal σ ──
// Iranian FX in one line: mostly quiet, with occasional step devaluations.
const jumpy = (() => {
  const base = normals(N, 5).map((z) => z * 0.004);
  const u = rng(909);
  return base.map((r) => (u() < 0.03 ? r + 0.06 : r)); // ~3% of days jump up hard (right skew for the holder)
})();
const jumpyDown = jumpy.map((r) => -r); // mirror it: the same shape as a loss-side tail
const calm = normals(N, 5).map((z) => z * 0.012);
// Measured at a 1-day horizon: aggregating 30 independent days washes the jump structure back
// towards normal (central limit), which is correct and is exactly why the engine scales skew by
// 1/√n and kurtosis by 1/n. The jump risk is visible at the horizon the jumps happen on.
const rJump = portfolioRisk([sleeve('j', 1, jumpyDown)], 1, { annualVolPct: 99, varPct: 99 });
const rCalm = portfolioRisk([sleeve('c', 1, calm)], 1, { annualVolPct: 99, varPct: 99 });
const jumpRatio = rJump.esPct! / rJump.varPct!;
const calmRatio = rCalm.esPct! / rCalm.varPct!;
assert.ok(
  jumpRatio > calmRatio * 1.2,
  `a jump-prone book must have a clearly heavier tail beyond VaR than a calm one (${jumpRatio.toFixed(3)} vs ${calmRatio.toFixed(3)})`,
);
// and the same book must look tamer once the horizon averages the jumps out
const rJumpLong = portfolioRisk([sleeve('j', 1, jumpyDown)], 90, { annualVolPct: 99, varPct: 99 });
assert.ok(
  rJumpLong.esPct! / rJumpLong.varPct! < jumpRatio,
  'over a long horizon the tail must converge back towards normal',
);
console.log(`fat-tail sensitivity OK (jumpy ES/VaR ${jumpRatio.toFixed(2)} vs calm ${calmRatio.toFixed(2)})`);

// ── 6. risk must grow with the horizon and with the risky weight ──
const short = portfolioRisk([sleeve('a', 1, a)], 30, { annualVolPct: 99, varPct: 99 });
const long = portfolioRisk([sleeve('a', 1, a)], 180, { annualVolPct: 99, varPct: 99 });
assert.ok(long.varPct! > short.varPct!, 'a longer horizon must carry more risk');
const halfCash = portfolioRisk(
  [sleeve('a', 0.5, a), { key: 'cash', weight: 0.5, series: null, fixedDaily: 0.0007 }],
  30,
  { annualVolPct: 99, varPct: 99 },
);
assert.ok(halfCash.varPct! < short.varPct! * 0.7, 'holding half in fixed income must cut the loss estimate roughly in half');
console.log('horizon & weight scaling OK');

// ── 7. too little history → fall back to the assumed numbers, and SAY so ──
const thin = portfolioRisk([sleeve('a', 1, a.slice(0, 20))], 30, { annualVolPct: 18, varPct: 9 });
assert.equal(thin.basis, 'assumed', 'a 20-day history must not be presented as a measurement');
assert.equal(thin.varPct, 9, 'the fallback must pass the assumed VaR through untouched');
assert.ok(thin.esPct! > thin.varPct!, 'even the fallback must report an ES worse than its VaR');
assert.ok(thin.notes.length > 0 && thin.notes[0].includes('فرضی'), 'the fallback must tell the user it is assuming, not measuring');
console.log('thin-history fallback OK');

// ── 8. the volMult knob really does make a sleeve riskier ──
const plain = portfolioRisk([sleeve('a', 1, a)], 30, { annualVolPct: 99, varPct: 99 });
const levered = portfolioRisk([{ ...sleeve('a', 1, a), volMult: 1.8 }], 30, { annualVolPct: 99, varPct: 99 });
assert.ok(levered.varPct! > plain.varPct! * 1.5, 'a 1.8× sleeve must show clearly more risk');
console.log('volMult OK');

console.log('\nportfolio-risk: all checks passed');
