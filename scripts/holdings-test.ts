/** Verifies entry grading (incl. no-lookahead), and the portfolio-similarity math. */
import assert from 'node:assert';
import { classOf, comparePortfolio, judgeEntry } from '../lib/engine/holdings-analysis';
import type { Portfolio } from '../lib/types';
import type { ValuedHolding } from '../lib/holdings';

const DAY = 86400000;
function mkSeries(n: number, f: (i: number) => number) {
  const dates: string[] = [];
  const prices: number[] = [];
  for (let i = 0; i < n; i++) {
    dates.push(new Date(Date.UTC(2025, 0, 1) + i * DAY).toISOString().slice(0, 10));
    prices.push(f(i));
  }
  return { dates, prices };
}

// ── 1. not enough prior history → no verdict (never a misleading grade) ──
const rising = mkSeries(300, (i) => 1000 * Math.exp(i * 0.004));
const tooEarly = judgeEntry(rising, rising.dates[20], rising.prices[20], rising.prices[299], true);
assert.equal(tooEarly.grade, 'unknown', 'fewer than 60 prior days must not be graded');
assert.ok(tooEarly.sinceBuyPct! > 0, 'but the realised move is still reported');
console.log('short history → unknown, outcome still shown OK');

// ── 2. a realistic uptrend (drift + noise) must NOT mark every entry as bad ──
// This is the bias a raw price-percentile has: in a rising market every buy looks "expensive".
// (A noiseless parabola with RSI 100 is genuinely overextended and *should* grade poor — see §3.)
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
let lvl = 1000;
const noisyUp = mkSeries(300, () => (lvl *= Math.exp(0.0012 + 0.015 * gauss())));
const grades = [120, 160, 200, 240, 280].map((i) => judgeEntry(noisyUp, noisyUp.dates[i], noisyUp.prices[i], noisyUp.prices[299], true));
console.log('noisy uptrend grades:', grades.map((g) => `${g.grade}/${g.overextension}`).join(' '));
assert.ok(grades.some((g) => g.grade !== 'poor'), 'a normal trend must produce some non-poor entries');
assert.ok(new Set(grades.map((g) => g.grade)).size > 1, 'grades should vary with the entry point, not be constant');

// the noiseless parabola is a separate case: RSI pinned at 100 is a real warning, so poor is correct
const parabola = judgeEntry(rising, rising.dates[200], rising.prices[200], rising.prices[299], true);
console.log(`noiseless parabola entry: grade=${parabola.grade} overextension=${parabola.overextension}`);
assert.equal(parabola.grade, 'poor', 'a vertical, pullback-free rise is an overextended entry');

// ── 3. a spike above trend → overextended ──
const spike = mkSeries(200, (i) => (i === 199 ? 2200 : 1000 + Math.sin(i / 9) * 25));
const atSpike = judgeEntry(spike, spike.dates[199], spike.prices[199], spike.prices[199], true);
console.log(`bought the spike: grade=${atSpike.grade} overextension=${atSpike.overextension}`);
assert.equal(atSpike.grade, 'poor', 'buying a vertical spike should grade poor');

// ── 4. a washout below trend → good entry ──
const dip = mkSeries(200, (i) => (i === 199 ? 600 : 1000 + Math.sin(i / 9) * 25));
const atDip = judgeEntry(dip, dip.dates[199], dip.prices[199], dip.prices[199], true);
console.log(`bought the washout: grade=${atDip.grade} overextension=${atDip.overextension}`);
assert.equal(atDip.grade, 'good', 'buying a deep dip should grade good');
assert.ok(atDip.overextension! < atSpike.overextension!, 'dip must score lower than spike');

// ── 5. no lookahead: truncating the future must not change the verdict ──
const full = judgeEntry(rising, rising.dates[150], rising.prices[150], rising.prices[299], true);
const cut = { dates: rising.dates.slice(0, 151), prices: rising.prices.slice(0, 151) };
const short = judgeEntry(cut, rising.dates[150], rising.prices[150], rising.prices[150], true);
assert.equal(full.overextension, short.overextension, 'verdict must not depend on post-purchase prices');
console.log('no-lookahead OK');

// ── 6. premium over market detected ──
const prem = judgeEntry(rising, rising.dates[150], rising.prices[150] * 1.1, rising.prices[299], true);
assert.ok(Math.abs(prem.premiumPct! - 10) < 0.01, `premium should be ~10%, got ${prem.premiumPct}`);
assert.ok(prem.text.includes('اجرت'), 'premium should be explained');
console.log('premium detection OK');

// ── 7. missing inputs ──
assert.equal(judgeEntry(rising, null, 1, 1, true).grade, 'unknown', 'no date');
assert.equal(judgeEntry(null, rising.dates[100], 1, 1, true).grade, 'unknown', 'no series');
assert.equal(judgeEntry(rising, '2010-01-01', 1, 1, true).grade, 'unknown', 'date before history');
console.log('missing inputs handled OK');

// ── 8. class mapping ──
const V = (instrument: string, kind: ValuedHolding['kind'], valueToman: number): ValuedHolding =>
  ({ id: instrument, instrument, kind, valueToman, paidToman: valueToman, qty: 1, boughtOn: null, note: null, addedAt: 0,
     label: instrument, unit: '', unitPriceToman: valueToman, pnlToman: 0, pnlPct: 0, buyUnitPriceToman: valueToman,
     priceSource: 'snapshot', priceNote: null }) as ValuedHolding;
assert.equal(classOf(V('usdt', 'crypto', 1)), 'cash', 'tether is cash-like, not a BTC bet');
assert.equal(classOf(V('doge', 'crypto', 1)), 'spec');
assert.equal(classOf(V('btc', 'crypto', 1)), 'btc');
assert.equal(classOf(V('coin_emami', 'coin', 1)), 'gold');
assert.equal(classOf(V('eur', 'currency', 1)), 'usd');
console.log('class mapping OK');

// ── 9. similarity math ──
const pf: Portfolio = {
  profile: 'balanced', horizon: 'm3', annualVolPct: 18, varPct: 9, notes: [],
  lines: [
    { cls: 'cash', label: 'درآمد ثابت', weight: 0.3, baseWeight: 0.3, instrument: '', rationale: '' },
    { cls: 'usd', label: 'دلار/تتر', weight: 0.2, baseWeight: 0.2, instrument: '', rationale: '' },
    { cls: 'gold', label: 'طلا', weight: 0.25, baseWeight: 0.25, instrument: '', rationale: '' },
    { cls: 'equity', label: 'سهام', weight: 0.2, baseWeight: 0.2, instrument: '', rationale: '' },
    { cls: 'btc', label: 'بیت‌کوین', weight: 0.05, baseWeight: 0.05, instrument: '', rationale: '' },
  ],
};

assert.equal(comparePortfolio([], pf, 0), null, 'no holdings → no score');

const allGold = comparePortfolio([V('g18', 'gold', 100)], pf, 100)!;
console.log(`single-asset (all gold): ${Math.round(allGold.similarityPct)}%`);
assert.ok(allGold.similarityPct < 40, 'a one-asset portfolio must score low');
assert.ok(allGold.topFix!.includes('طلا'), `top fix should name gold, got: ${allGold.topFix}`);
assert.ok(Math.abs(allGold.classes.reduce((a, c) => a + c.mine, 0) - 1) < 1e-9, 'own weights sum to 1');

// matches the suggestion except it cannot hold equity (20%) → should lose ~20 points, no more
const aligned = comparePortfolio(
  [V('usdt', 'crypto', 30), V('usd', 'currency', 20), V('g18', 'gold', 25), V('btc', 'crypto', 5)],
  pf, 80,
)!;
console.log(`aligned but no equity: ${Math.round(aligned.similarityPct)}%`);
assert.ok(aligned.similarityPct > 70 && aligned.similarityPct < 90, `expected ~80%, got ${aligned.similarityPct}`);
assert.ok(aligned.similarityPct > allGold.similarityPct, 'diversified must beat single-asset');

// an exact replica scores 100
const exact = comparePortfolio(
  [V('usdt', 'crypto', 30), V('usd', 'currency', 20), V('g18', 'gold', 25), V('btc', 'crypto', 5), V('fakeEquity', 'gold', 0)],
  { ...pf, lines: pf.lines.filter((l) => l.cls !== 'equity').map((l) => ({ ...l, weight: l.weight / 0.8 })) },
  80,
)!;
console.log(`exact replica: ${Math.round(exact.similarityPct)}%`);
assert.ok(exact.similarityPct > 99.9, `identical weights should be 100%, got ${exact.similarityPct}`);

// overweight one class → gap reported with the right sign
const heavy = comparePortfolio([V('btc', 'crypto', 60), V('usdt', 'crypto', 40)], pf, 100)!;
const btcRow = heavy.classes.find((c) => c.cls === 'btc')!;
assert.ok(btcRow.gapPct > 0, 'holding more BTC than suggested must read as a positive gap');
assert.ok(btcRow.advice.includes('بیشتر'), `advice should say "more", got: ${btcRow.advice}`);
console.log('similarity math OK');

console.log('\nHOLDINGS ANALYSIS OK');
