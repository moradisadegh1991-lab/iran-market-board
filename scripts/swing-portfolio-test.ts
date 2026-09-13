import assert from 'node:assert';
import { runSwingPortfolio } from '@/lib/engine/swing-portfolio';
import { runSwing, type SwingBar } from '@/lib/engine/swing';

let seed = 999;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const H = 3600_000;
const T0 = Date.UTC(2026, 0, 1);
function bars(n: number, drift: number, vol: number, offset = 0): SwingBar[] {
  const out: SwingBar[] = []; let p = 100;
  for (let i = 0; i < n; i++) { p *= Math.exp(drift + vol * gauss()); out.push({ t: T0 + (i + offset) * H, p }); }
  return out;
}
const cfg = { preset: 'normal' as const, feePct: 0.4, usdtRial: 1e7, capitalToman: 1e9 };
const A = { id: 'a', symbol: 'AAA', name: 'A' }, B = { id: 'b', symbol: 'BBB', name: 'B' }, C = { id: 'c', symbol: 'CCC', name: 'C' };
const ba = bars(1400, 0.0004, 0.008), bb = bars(1400, -0.0002, 0.010), bc = bars(1400, 0.0001, 0.006);

const pf = runSwingPortfolio([{ coin: A, bars: ba }, { coin: B, bars: bb }, { coin: C, bars: bc }], cfg);
console.log('used', pf.used, 'return', pf.combined.returnPct.toFixed(2) + '%', 'bh', pf.combined.buyHoldPct!.toFixed(2) + '%', 'trades', pf.combined.trades, 'DD', pf.combined.maxDrawdownPct.toFixed(1) + '%');

// 1) each sleeve must equal running that coin alone with capital/N — no cross-subsidy
for (const [coin, b] of [[A, ba], [B, bb], [C, bc]] as const) {
  const solo = runSwing(b, coin, { ...cfg, capitalToman: 1e9 / 3 });
  const sleeve = pf.sleeves.find((s) => s.coin.id === coin.id)!.result!;
  assert.equal(sleeve.metrics.finalEquity.toFixed(6), solo.metrics.finalEquity.toFixed(6), `sleeve ${coin.symbol} differs from solo run`);
}
console.log('sleeves match independent runs OK');

// 2) combined final equity == sum of sleeve finals (no money invented)
const sum = pf.sleeves.reduce((a, s) => a + (s.result ? s.result.metrics.finalEquity : 0), 0);
assert.ok(Math.abs(pf.combined.finalEquity - sum) < 1, `combined ${pf.combined.finalEquity} != sum ${sum}`);
console.log('combined equals sum of sleeves OK');

// 3) equity curve is chronological and never negative
const ts = pf.equity.map((p) => p.t);
assert.deepEqual(ts, [...ts].sort((a, b) => a - b), 'equity not chronological');
assert.ok(pf.equity.every((p) => p.equity > 0), 'equity went non-positive');

// 4) a failed coin must not silently vanish: its cash is held, not lost
const withBad = runSwingPortfolio([{ coin: A, bars: ba }, { coin: B, bars: null, error: 'boom' }], cfg);
assert.equal(withBad.used, 1);
assert.ok(withBad.warnings.some((w) => w.includes('BBB')), 'failed coin should be named in warnings');
const soloA = runSwing(ba, A, { ...cfg, capitalToman: 5e8 });
assert.ok(Math.abs(withBad.combined.finalEquity - (soloA.metrics.finalEquity + 5e8)) < 1, 'idle sleeve cash not preserved');
console.log('failed sleeve keeps its cash OK');

// 5) misaligned histories (one coin starts later) must not create a jump
const late = bars(700, 0.0003, 0.008, 700);
const pf2 = runSwingPortfolio([{ coin: A, bars: ba }, { coin: C, bars: late }], cfg);
const first = pf2.equity[0].equity;
assert.ok(Math.abs(first - 1e9) < 1e9 * 0.02, `portfolio should start near capital, got ${first}`);
const jumps = pf2.equity.slice(1).map((p, i) => Math.abs(p.equity / pf2.equity[i].equity - 1));
assert.ok(Math.max(...jumps) < 0.25, `no single-step jump from data misalignment (max ${(Math.max(...jumps) * 100).toFixed(1)}%)`);
console.log('misaligned histories OK');

// 6) all coins failing is an error, not a fake zero
assert.throws(() => runSwingPortfolio([{ coin: A, bars: null, error: 'x' }], cfg), /داده ساعتی کافی/);
console.log('all-failed throws OK');

console.log('\nSWING PORTFOLIO OK');
