/** Verifies the auto-scan selects on the older half only and reports the unseen half honestly. */
import assert from 'node:assert';
import { scanSwing } from '@/lib/engine/swing-scan';
import type { SwingBar } from '@/lib/engine/swing';

let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const H = 3600_000, T0 = Date.UTC(2026, 0, 1);

/** first half uses driftA, second half driftB — lets us plant a regime flip */
function bars(n: number, driftA: number, driftB: number, vol: number): SwingBar[] {
  const out: SwingBar[] = []; let p = 100;
  for (let i = 0; i < n; i++) { p *= Math.exp((i < n / 2 ? driftA : driftB) + vol * gauss()); out.push({ t: T0 + i * H, p }); }
  return out;
}
const cfg = { preset: 'normal' as const, feePct: 0.4, usdtRial: 1e7, capitalToman: 1e8 };
const C = (id: string) => ({ id, symbol: id.toUpperCase(), name: id });

// ── 1. selection must use ONLY the first half ──
// "trap" looks great in the first half and terrible in the second. A scan that peeked at the
// second half would refuse to pick it; an honest one picks it and then reports the damage.
const trap = bars(1600, 0.0012, -0.0012, 0.008);
const steady = bars(1600, 0.0002, 0.0002, 0.007);
const weak = bars(1600, -0.0008, -0.0002, 0.009);
const scan = scanSwing([
  { coin: C('trap'), bars: trap },
  { coin: C('steady'), bars: steady },
  { coin: C('weak'), bars: weak },
], cfg, 2);

console.log('ranking:', scan.candidates.filter(c => c.ok).map(c => `${c.coin.symbol}(in ${c.inSample!.returnPct.toFixed(1)}% / out ${c.outSample!.returnPct.toFixed(1)}%)`).join('  '));
console.log('selected:', scan.selected.map(c => c.coin.symbol).join(', '));
console.log('verdict:', scan.verdict);

assert.equal(scan.selected.length, 2, 'should pick exactly the requested count');
assert.ok(scan.selected.every(c => c.selected), 'selected flag must be set');
// ranking order must follow the in-sample score, never the out-of-sample result
const usable = scan.candidates.filter(c => c.ok);
const scores = usable.map(c => c.inSample!.score);
assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'candidates must be ordered by in-sample score');
const top = usable[0];
const bestOut = [...usable].sort((a, b) => b.outSample!.returnPct - a.outSample!.returnPct)[0];
console.log('top by in-sample:', top.coin.symbol, '| best by out-of-sample:', bestOut.coin.symbol);

// ── 2. both halves reported for every usable candidate ──
for (const c of usable) {
  assert.ok(c.inSample && c.outSample, `${c.coin.symbol} missing a half`);
  assert.ok(Number.isFinite(c.outSample!.returnPct) && Number.isFinite(c.outSample!.buyHoldPct));
}
console.log('both halves reported OK');

// ── 3. the benchmark (all candidates) is computed, so "did picking help" is answerable ──
assert.ok(scan.allCandidatesReturnPct !== null && scan.outSampleReturnPct !== null);
const edge = scan.outSampleReturnPct! - scan.allCandidatesReturnPct!;
console.log(`edge over picking-everything: ${edge.toFixed(2)} pp`);
assert.ok(/انتخاب خودکار/.test(scan.verdict), 'verdict must state whether selection added value');

// ── 4. coins with too few trades are excluded, not silently ranked ──
const flat: SwingBar[] = Array.from({ length: 1600 }, (_, i) => ({ t: T0 + i * H, p: 100 }));
const s2 = scanSwing([{ coin: C('flat'), bars: flat }, { coin: C('steady'), bars: steady }], cfg, 1);
const flatC = s2.candidates.find(c => c.coin.id === 'flat')!;
assert.equal(flatC.selected, false, 'a never-trading coin must not be selected');
console.log('low-trade coin excluded:', flatC.reason ?? '(no reason)');

// ── 5. failed downloads surface as warnings, not silent drops ──
const s3 = scanSwing([{ coin: C('steady'), bars: steady }, { coin: C('gone'), bars: null, error: '404' }], cfg, 1);
assert.ok(s3.warnings.some(w => w.includes('GONE')), 'failed coin must be named');
assert.equal(s3.candidates.find(c => c.coin.id === 'gone')!.ok, false);
console.log('failed download reported OK');

// ── 6. everything failing is an error, not an empty success ──
assert.throws(() => scanSwing([{ coin: C('x'), bars: null, error: 'e' }], cfg, 1), /داده کافی/);

// ── 7. the overfitting caveat is always present ──
assert.ok(scan.warnings.some(w => w.includes('تضمینی')), 'must always carry the past-performance caveat');
console.log('caveat always present OK');

console.log('\nSWING SCAN OK');
