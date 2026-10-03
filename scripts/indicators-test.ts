/**
 * Pins the chart indicators (lib/indicators.ts): values against hand-computed ones, the warm-up
 * history (a 200-day average from the first visible day), gaps instead of padding, and readings
 * that describe without telling anyone to buy or sell.
 * Run: npx tsx scripts/indicators-test.ts
 */
import assert from 'node:assert';
import { bollinger, computeIndicators, indicatorEvidence, macd, readings, smaSeries, type IndicatorKey } from '../lib/indicators';
import { emaSeries, rsiSeries } from '../lib/engine/stats';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const DAY = 86_400_000;
const series = (vals: number[], start = Date.parse('2025-01-01T12:00:00Z')): [number, number][] => vals.map((v, i) => [start + i * DAY, v]);

ok('SMA: hand-computed, null until the window is full', () => {
  const s = smaSeries([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(s.slice(0, 2), [null, null]);
  close(s[2], 2);
  close(s[5], 5);
});

ok('EMA 3 over 1..6: seeded with the first SMA, k = 1/2', () => {
  const e = emaSeries([1, 2, 3, 4, 5, 6], 3);
  close(e[2], 2);
  close(e[3], 3); // 4·½ + 2·½
  close(e[5], 5);
});

ok('Bollinger: flat prices → bands on the middle; 20 closes 1..20 → σ = √33.25', () => {
  const flat = bollinger(new Array(25).fill(100));
  close(flat.upper[24], 100);
  close(flat.lower[24], 100);
  const b = bollinger(Array.from({ length: 20 }, (_, i) => i + 1));
  close(b.mid[19], 10.5);
  close(b.upper[19], 10.5 + 2 * Math.sqrt(33.25));
  close(b.lower[19], 10.5 - 2 * Math.sqrt(33.25));
});

ok('MACD: zero on flat prices, positive on a steady rise, histogram = MACD − signal', () => {
  const flat = macd(new Array(60).fill(50));
  close(flat.macd[59], 0);
  close(flat.signal[59], 0);
  const up = macd(Array.from({ length: 80 }, (_, i) => 100 + i));
  assert.ok(up.macd[25] !== null && up.macd[24] === null, 'starts at the slow EMA');
  assert.ok(up.signal[33] !== null && up.signal[32] === null, 'signal 9 later');
  assert.ok(up.macd[79]! > 0);
  close(up.hist[79], up.macd[79]! - up.signal[79]!);
});

ok('RSI: 100 on a pure rise, 0 on a pure fall, 50 on alternating equal moves', () => {
  close(rsiSeries(Array.from({ length: 30 }, (_, i) => i + 1))[29], 100);
  close(rsiSeries(Array.from({ length: 30 }, (_, i) => 100 - i))[29], 0);
  close(rsiSeries(Array.from({ length: 31 }, (_, i) => (i % 2 ? 101 : 100)))[30], 50, 6);
});

ok('warm-up: with 260 days before the window, MA200 exists on the first visible day; without it, only after 200', () => {
  const all = series(Array.from({ length: 400 }, (_, i) => 1000 + 3 * i + 40 * Math.sin(i / 7)));
  const visible = all.slice(-30);
  const warm = all.slice(-290, -30);
  const keys: IndicatorKey[] = ['ma20', 'ma50', 'ma200', 'ema20', 'bb', 'rsi', 'macd'];
  const withWarm = computeIndicators(visible, warm, keys);
  const ma200 = withWarm.overlays.find((o) => o.key === 'ma200')!.points;
  assert.equal(ma200.length, 30, 'cut to the visible window');
  assert.ok(ma200.every(([, v]) => v !== null));
  // the value equals the plain average of the 200 closes up to that day
  const lastAvg = all.slice(-200).reduce((s, p) => s + p[1], 0) / 200;
  close(ma200[29][1], lastAvg, 1e-6);
  assert.ok(withWarm.rsi!.every(([, v]) => v !== null) && withWarm.macd!.signal.every(([, v]) => v !== null));
  const cold = computeIndicators(visible, [], keys);
  assert.ok(cold.overlays.find((o) => o.key === 'ma200')!.points.every(([, v]) => v === null), 'no padding, no extrapolation');
  assert.ok(cold.overlays.find((o) => o.key === 'ma20')!.points[19][1] !== null);
  // warm-up rows at or after the first visible day are ignored (no double counting)
  const overlap = computeIndicators(visible, all.slice(-290), ['ma20']);
  close(overlap.overlays[0].points[29][1]!, withWarm.overlays.find((o) => o.key === 'ma20')!.points[29][1]!);
});

ok('readings describe; they never say buy or sell', () => {
  // an accelerating rise: MACD keeps pulling away above its signal line
  const pts = series(Array.from({ length: 300 }, (_, i) => 100 * 1.01 ** i));
  const lines = computeIndicators(pts.slice(-60), pts.slice(0, -60), ['ma50', 'ma200', 'bb', 'rsi', 'macd']);
  const r = readings(pts.slice(-60), lines);
  // a steady linear rise: MACD settles on its signal line — read as a tie, not a crossing
  const lin = series(Array.from({ length: 300 }, (_, i) => 100 + i));
  assert.ok(readings(lin.slice(-60), computeIndicators(lin.slice(-60), lin.slice(0, -60), ['macd'])).some((x) => /تقریباً روی خط سیگنال/.test(x)));
  assert.ok(r.some((x) => /بالای میانگین ۵۰/.test(x)));
  assert.ok(r.some((x) => /RSI ۱۴ برابر ۱۰۰/.test(x) && /اشباع خرید/.test(x)));
  assert.ok(r.some((x) => /MACD بالای خط سیگنال/.test(x)));
  for (const x of [...r, indicatorEvidence('rial'), indicatorEvidence('crypto'), indicatorEvidence('other')]) assert.doesNotMatch(x, /بخرید|بفروشید|خرید کنید|فروش کنید|سیگنال خرید است/);
  assert.match(indicatorEvidence('rial'), /نه سیگنال خرید یا فروش/);
});

console.log(`\nindicators: ${n} checks OK`);
