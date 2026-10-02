// The swing engine's toman figures used to be dollar figures wearing a toman label: the whole
// backtest converted at one fixed tether rate, so the rial leg of an Iranian holder's return —
// often the bigger half — silently vanished. These checks lock the fix in place, and lock the
// old behaviour in place for callers that have no daily rate to give.
import assert from 'node:assert';
import { runSwing, type SwingBar } from '../lib/engine/swing';
import { msToTehranDate } from '../lib/num';

let seed = 20260920;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const H = 3600_000;
const T0 = Date.UTC(2026, 0, 1);

function bars(n: number, drift: number, vol: number): SwingBar[] {
  const out: SwingBar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= Math.exp(drift + vol * gauss());
    out.push({ t: T0 + i * H, p });
  }
  return out;
}

/** one rate per Tehran day covered by the bars, compounding at `dailyDrift` */
function rateSeries(b: SwingBar[], startRate: number, dailyDrift: number): Map<string, number> {
  const m = new Map<string, number>();
  let day = 0;
  let last = '';
  for (const bar of b) {
    const d = msToTehranDate(bar.t);
    if (d !== last) {
      m.set(d, startRate * Math.pow(1 + dailyDrift, day));
      day++;
      last = d;
    }
  }
  return m;
}

const COIN = { id: 'x', symbol: 'X', name: 'X' };
const BASE = { capitalToman: 1e8, preset: 'normal' as const, feePct: 0.4, usdtRial: 1e7 };
const data = bars(1800, 0.0004, 0.008);

// ── 1. no daily rate → byte-identical to the old fixed-rate behaviour, and it SAYS so ──
const fixed = runSwing(data, COIN, BASE);
assert.equal(fixed.metrics.fixedFx, true, 'without a daily series the result must be flagged as fixed-FX');
assert.equal(fixed.metrics.usdtPct, null, 'a fixed rate cannot produce a tether benchmark — null, not a fake zero');
assert.ok(
  fixed.warnings.some((w) => w.includes('نرخ تتر در کل بازه ثابت')),
  'the user must be told the toman numbers are really dollar numbers',
);
console.log(`fixed-FX run: ${fixed.metrics.trades} trades, return ${fixed.metrics.returnPct.toFixed(2)}%`);

// ── 2. a FLAT daily rate must reproduce the fixed-rate numbers exactly ──
// This is the real regression guard: the new code path must collapse onto the old one.
const flatRates = rateSeries(data, 1e7, 0);
const flat = runSwing(data, COIN, { ...BASE, usdtRialByDate: flatRates });
assert.equal(flat.metrics.fixedFx, false);
assert.ok(
  Math.abs(flat.metrics.returnPct - fixed.metrics.returnPct) < 1e-9,
  `a flat rate series must give the same return as a fixed rate (${flat.metrics.returnPct} vs ${fixed.metrics.returnPct})`,
);
assert.equal(flat.metrics.trades, fixed.metrics.trades, 'and the same trades');
assert.ok(Math.abs(flat.metrics.usdtPct!) < 1e-9, 'a flat tether rate means the tether benchmark is 0%');
console.log('flat daily rate reproduces the fixed-rate result exactly');

// ── 3. a RISING tether must lift the toman return above the dollar return ──
// This is the number that was missing: the same coin trades, but the rial fell underneath them.
const rising = rateSeries(data, 1e7, 0.004); // ~0.4%/day
const up = runSwing(data, COIN, { ...BASE, usdtRialByDate: rising });
assert.ok(up.metrics.usdtPct! > 20, `the tether benchmark must show the rial leg, got ${up.metrics.usdtPct}`);
assert.ok(
  up.metrics.returnPct > fixed.metrics.returnPct,
  `with the tether rising, the toman return must beat the dollar-equivalent one (${up.metrics.returnPct.toFixed(2)}% vs ${fixed.metrics.returnPct.toFixed(2)}%)`,
);
assert.ok(
  up.metrics.buyHoldPct > fixed.metrics.buyHoldPct,
  'buy & hold must carry the same rial leg, or the comparison is rigged in the strategy\'s favour',
);
console.log(
  `rising tether (+${up.metrics.usdtPct!.toFixed(1)}%): strategy ${up.metrics.returnPct.toFixed(2)}% vs ` +
    `buy&hold ${up.metrics.buyHoldPct.toFixed(2)}% vs tether ${up.metrics.usdtPct!.toFixed(2)}%`,
);

// ── 4. a FALLING tether must drag the toman return below the dollar one ──
const falling = rateSeries(data, 1e7, -0.003);
const down = runSwing(data, COIN, { ...BASE, usdtRialByDate: falling });
assert.ok(down.metrics.usdtPct! < -10, 'a falling tether must show as a negative benchmark');
assert.ok(
  down.metrics.returnPct < fixed.metrics.returnPct,
  'a falling rial-price of tether must reduce the toman return',
);
console.log(`falling tether (${down.metrics.usdtPct!.toFixed(1)}%): strategy ${down.metrics.returnPct.toFixed(2)}%`);

// ── 5. the strategy must be measured against the local hurdle rate, not just against zero ──
for (const r of [fixed, up, down]) {
  assert.ok(r.metrics.fixedIncomePct !== null && r.metrics.fixedIncomePct > 0, 'a fixed-income benchmark must always be present');
}
const lowHurdle = runSwing(data, COIN, { ...BASE, riskFreeAnnual: 0 });
const highHurdle = runSwing(data, COIN, { ...BASE, riskFreeAnnual: 0.6 });
assert.ok(highHurdle.metrics.fixedIncomePct! > lowHurdle.metrics.fixedIncomePct!, 'the hurdle must follow the configured rate');
assert.ok(
  highHurdle.metrics.sharpe! < lowHurdle.metrics.sharpe!,
  'a higher risk-free rate must lower the Sharpe — that is the whole point of subtracting it',
);
console.log(
  `hurdle: fixed income ${fixed.metrics.fixedIncomePct!.toFixed(2)}% over the window; ` +
    `Sharpe at rf=0 is ${lowHurdle.metrics.sharpe!.toFixed(2)}, at rf=60% it is ${highHurdle.metrics.sharpe!.toFixed(2)}`,
);

// ── 6. the trade-quality metrics have to agree with the trades they summarise ──
const m = fixed.metrics;
const ts = fixed.trades;
assert.ok(ts.length >= 3, 'need trades to check the metrics against');
const winsT = ts.filter((t) => t.pnlToman > 0);
const lossT = ts.filter((t) => t.pnlToman <= 0);
const gw = winsT.reduce((a, t) => a + t.pnlToman, 0);
const gl = -lossT.reduce((a, t) => a + t.pnlToman, 0);
assert.ok(Math.abs(m.profitFactor! - gw / gl) < 1e-9, 'profit factor must equal gross win ÷ gross loss');
const meanNet = ts.reduce((a, t) => a + t.netPct, 0) / ts.length;
assert.ok(Math.abs(m.expectancyPct! - meanNet) < 1e-9, 'expectancy must equal the mean net % per trade');
assert.ok(m.maxConsecLosses >= 0 && m.maxConsecLosses <= ts.length, 'losing streak must be within range');
// recompute the streak independently
let run = 0, worst = 0;
for (const t of ts) { run = t.pnlToman <= 0 ? run + 1 : 0; worst = Math.max(worst, run); }
assert.equal(m.maxConsecLosses, worst, 'losing streak must match a direct recount');
assert.ok(m.sortino === null || m.sharpe === null || m.sortino >= m.sharpe - 1e-9, 'Sortino punishes only downside, so it cannot be below Sharpe');
console.log(
  `trade quality: PF ${m.profitFactor!.toFixed(2)}, expectancy ${m.expectancyPct!.toFixed(2)}%, ` +
    `payoff ${m.payoffRatio?.toFixed(2) ?? '—'}, worst losing streak ${m.maxConsecLosses}`,
);

// ── 7. a too-short sample must refuse to report a Sharpe rather than invent one ──
const shortRun = runSwing(data.slice(0, 260), COIN, BASE);
assert.equal(shortRun.metrics.sharpe, null, 'a 260-bar sample is too thin for an annualised Sharpe');
console.log('thin sample refuses to report a Sharpe OK');

console.log('\nSWING FX & METRICS OK');
