/**
 * «چرا این پیش‌بینی؟» (rule 94): the pure half (lib/engine/forecast-why.ts). The paths after similar days end exactly at the
 * move the forecast counted and never read past it; the three readings' pulls add up to zero; news is read per asset,
 * never from after the day it is shown, one story counted once; the reasons never tell anyone to buy or sell and mark the
 * news as outside the numbers — and the files that compute the forecast do not import the news at all.
 * Run: npx tsx scripts/forecast-why-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { forwardIndex } from '../lib/engine/forecast-model';
import { analogPaths, forecastReasons, newsView, NEWS_ASSET, NEWS_EVIDENCE, pulls, trendFacts, type PartView } from '../lib/engine/forecast-why';
import type { ScoredNews } from '../lib/engine/simulator';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const DAY = 86_400_000;
const iso = (i: number) => new Date(Date.parse('2024-01-01T00:00:00Z') + i * DAY).toISOString().slice(0, 10);
const dates = Array.from({ length: 400 }, (_, i) => iso(i));
const prices = dates.map((_, i) => 100 * Math.exp(0.002 * i + 0.03 * Math.sin(i / 7)));

ok('paths: start at 0, end exactly at the move the forecast counted, and never read past date + horizon', () => {
  const days = 30;
  const fwd = forwardIndex(dates, days);
  const picks = [40, 120, 200].map((i) => ({ date: dates[i], movePct: (prices[fwd[i]] / prices[i] - 1) * 100 }));
  const ps = analogPaths(dates, prices, picks, days, 10);
  assert.equal(ps.length, 3);
  for (const p of ps) {
    assert.deepEqual(p.path[0], [0, 0]);
    assert.equal(p.path.length, 11);
    assert.ok(Math.abs(p.path[p.path.length - 1][1] - p.movePct) < 1e-9, 'ends at the counted move');
    assert.equal(p.path[p.path.length - 1][0], days);
  }
  // a poisoned future: prices after date + days must not change a path
  const i = 120;
  const poisoned = prices.map((v, k) => (k > fwd[i] ? v * 50 : v));
  const again = analogPaths(dates, poisoned, [picks[1]], days, 10)[0];
  assert.deepEqual(again.path, ps[1].path);
  // a date that is not in the series is skipped; a match too close to the end gives a shorter (or no) path, never invented points
  assert.equal(analogPaths(dates, prices, [{ date: '1999-01-01', movePct: 0 }], days).length, 0);
  const tail = analogPaths(dates, prices, [{ date: dates[395], movePct: 0 }], days, 10);
  assert.ok(tail.length === 0 || tail[0].path.length < 11);
});

ok('trend: one and three month moves and the distance from the 200-row average, from rows up to today', () => {
  const t = trendFacts(dates, prices, prices[399]);
  const at = (d: number) => prices[399 - d];
  assert.ok(Math.abs(t.ret1mPct! - (prices[399] / at(30) - 1) * 100) < 1e-9);
  assert.ok(Math.abs(t.ret3mPct! - (prices[399] / at(91) - 1) * 100) < 1e-9);
  const ma = prices.slice(200).reduce((s, v) => s + v, 0) / 200;
  assert.ok(Math.abs(t.vsMa200Pct! - (prices[399] / ma - 1) * 100) < 1e-9);
  assert.equal(trendFacts(dates.slice(0, 100), prices.slice(0, 100), prices[99]).vsMa200Pct, null, 'under 200 rows: no average');
  assert.deepEqual(trendFacts([], [], 1), { ret1mPct: null, ret3mPct: null, vsMa200Pct: null });
});

const part = (low: number, mid: number, high: number, pUp = 0.55): PartView => ({ lowPct: low, midPct: mid, highPct: high, pUp });

ok('pulls: each reading’s median minus the average one (log), adding up to zero; the biggest puller is the outlier', () => {
  const parts = { engine: part(-10, 4, 19), empirical: part(-9, 3, 17), analog: part(-14, 12, 29) };
  const p = pulls(parts);
  assert.ok(Math.abs(p.engine + p.empirical + p.analog) < 1e-9);
  assert.ok(p.analog > 0 && p.engine < 0 && p.empirical < 0);
  assert.ok(Math.abs(p.analog) > Math.abs(p.engine) && Math.abs(p.analog) > Math.abs(p.empirical));
  const same = pulls({ engine: part(-5, 3, 9), empirical: part(-5, 3, 9), analog: part(-5, 3, 9) });
  assert.ok(Math.abs(same.engine) + Math.abs(same.empirical) + Math.abs(same.analog) < 1e-9);
});

const news = (date: string, title: string, e: number, facts = ['تنش ژئوپلیتیک'], source = 'Reuters', weight = 1): ScoredNews => ({
  id: title.slice(0, 8),
  date,
  ms: Date.parse(`${date}T09:00:00Z`),
  title,
  source,
  url: `https://example.com/${encodeURIComponent(title).slice(0, 20)}`,
  effects: { usd: e, g18: e / 2, btc: -e / 2 },
  facts,
  weight,
});
const ASOF = '2026-10-10';

ok('news: per asset, inside the window, never after the day shown; daily score and net; a story counted once however many outlets', () => {
  const items: ScoredNews[] = [
    news('2026-10-09', 'Trump denies offering Iran sanctions relief for nuclear concessions', -0.8, ['نشانه توافق یا کاهش تحریم'], 'Reuters'),
    news('2026-10-09', 'Trump denies willingness to give Iran sanctions relief in exchange for nuclear concessions', -0.8, ['نشانه توافق یا کاهش تحریم'], 'CNBC'),
    news('2026-10-08', 'Trump denies Iran sanctions relief for nuclear concessions, officials say', -0.8, ['نشانه توافق یا کاهش تحریم'], 'CNN'),
    news('2026-10-05', 'US targets Iran auto, rail and metals sectors in new sanctions blitz', 0.8, ['تشدید تحریم یا شکست مذاکره'], 'Iran International'),
    news('2026-10-05', 'US targets Iran auto, rail and metals sectors in new sanctions blitz', 0.8, ['تشدید تحریم یا شکست مذاکره'], 'dup of the line above'),
    news('2026-10-11', 'A headline dated after the day shown', 0.9),
    news('2026-08-01', 'Too old to be in the window', 0.9),
  ];
  const v = newsView(items, 'usd', ASOF)!;
  assert.equal(v.daily.length, 45);
  assert.equal(v.daily[44].date, ASOF);
  assert.equal(v.to, ASOF);
  assert.equal(v.count, 2, 'two stories: the relief denials are one, the new sanctions another');
  const denial = v.headlines.find((h) => /denies/.test(h.title))!;
  assert.equal(denial.outlets, 3);
  // a story is dated by its first appearance (10-08, CNN) and pushes once, however many outlets followed
  assert.equal(v.daily.find((d) => d.date === '2026-10-08')!.score, -0.8, 'one story, one push');
  assert.equal(v.daily.find((d) => d.date === '2026-10-09')!.score, 0);
  assert.equal(denial.date, '2026-10-08');
  assert.equal(v.daily.find((d) => d.date === '2026-10-05')!.score, 0.8);
  assert.ok(!v.headlines.some((h) => /after the day shown|Too old/.test(h.title)));
  assert.equal(v.up, 1);
  assert.equal(v.down, 1);
  assert.equal(v.tone, 'mixed');
  assert.ok(Math.abs(v.net - 0) < 1e-9);
  // the same headlines through another asset: the effect is that asset’s own; no effect there = not listed
  const g = newsView(items, 'g18', ASOF)!;
  assert.equal(g.headlines.find((h) => /denies/.test(h.title))!.effect, -0.4);
  assert.equal(newsView(items, 'silver', ASOF)!.count, g.count, 'silver reads gold’s lexicon');
  assert.equal(newsView(items, 'nope', ASOF), null);
  assert.ok(Object.values(NEWS_ASSET).every((x) => x === null || typeof x === 'string'));
});

ok('news: gold priced in dollars (ons) only counts the global-macro facts; tone needs a clear lead', () => {
  const items: ScoredNews[] = [
    news('2026-10-09', 'Iran sanctions tighten again', 0.8, ['تشدید تحریم یا شکست مذاکره']),
    news('2026-10-08', 'Fed signals rate cuts as inflation cools', 1, ['انتظار کاهش نرخ بهره آمریکا']),
    news('2026-10-07', 'Rate cuts priced in for December, Powell hints at easing', 1, ['انتظار کاهش نرخ بهره آمریکا']),
  ];
  const ons = newsView(items, 'ons', ASOF)!;
  assert.deepEqual(ons.headlines.map((h) => h.facts[0]), ['انتظار کاهش نرخ بهره آمریکا', 'انتظار کاهش نرخ بهره آمریکا'], 'the Iran-sanctions story is not about the ounce');
  assert.equal(ons.tone, 'up');
  assert.equal(newsView([], 'usd', ASOF)!.tone, 'none');
});

const base = {
  hLabel: 'ماهانه',
  midPct: 4,
  lowPct: -12,
  highPct: 22,
  pUp: 0.6,
  parts: { engine: part(-11, 4, 19), empirical: part(-9, 3, 17), analog: part(-14, 5, 29, 0.6) },
  analog: { n: 150, matches: [3, -2, 8, 1, -5, 6].map((m, i) => ({ date: iso(i), movePct: m })) },
  trend: { ret1mPct: 17, ret3mPct: 46, vsMa200Pct: 45 },
  annualVolPct: 31,
  news: null,
};

ok('reasons: the five of them, in plain Persian; the news one says it is outside the numbers; no advice to buy or sell', () => {
  const v = newsView([news('2026-10-09', 'US targets Iran sectors in new sanctions blitz', 0.8, ['تشدید تحریم یا شکست مذاکره'])], 'usd', ASOF)!;
  const rs = forecastReasons({ ...base, news: v });
  assert.deepEqual(rs.map((r) => r.id), ['agree', 'analog', 'trend', 'vol', 'news']);
  assert.equal(rs.find((r) => r.id === 'news')!.inNumbers, false);
  assert.ok(rs.filter((r) => r.id !== 'news').every((r) => r.inNumbers));
  assert.match(rs[0].title, /هم‌نظرند/);
  assert.match(rs.find((r) => r.id === 'analog')!.text, /۱۵۰ روز/);
  assert.match(rs.find((r) => r.id === 'analog')!.text, /۴ تا بالاتر و ۲ تا پایین‌تر/);
  assert.match(rs.find((r) => r.id === 'news')!.text, /دخالت ندارند/);
  // readings that disagree are said to disagree
  const split = forecastReasons({ ...base, parts: { engine: part(-11, -4, 8), empirical: part(-9, 3, 17), analog: part(-14, 18, 40) } });
  assert.match(split[0].title, /اختلاف/);
  assert.match(split[0].text, /بیشترین کشش از «الگوهای مشابه»/);
  // an asset without the three-way ensemble says so; with no news loaded there is no news reason
  const eng = forecastReasons({ ...base, parts: null, analog: null, news: null });
  assert.deepEqual(eng.map((r) => r.id), ['agree', 'trend', 'vol']);
  assert.match(eng[0].title, /فقط موتور/);
  const all = JSON.stringify([...rs, ...split, ...eng]) + NEWS_EVIDENCE.text;
  assert.doesNotMatch(all, /(بخرید|بفروشید|خرید کنید|بفروش|توصیه می‌کنیم)/);
  assert.doesNotMatch(all, /سود (تضمینی|قطعی)/);
});

ok('the numbers never depend on news: the files that make the forecast do not import any news module', () => {
  const files = ['lib/engine/forecast.ts', 'lib/engine/forecast-model.ts', 'lib/engine/forecast-timing.ts', 'lib/engine/scenario.ts', 'lib/engine/risk.ts'];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    // `import … from '…'`, a bare `import '…'`, `require('…')` and a dynamic `import('…')` alike
    assert.doesNotMatch(src, /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"][^'"]*(?:\/news|forecast-why|sources\/news)['"]/, `${f} imports news`);
  }
  // the route builds the cone from rows that exist before any `why` ingredient is touched
  const route = fs.readFileSync('app/api/forecast/route.ts', 'utf8');
  assert.doesNotMatch(route, /forecast-news|loadNews|newsView/, 'forecast route reads news');
  assert.ok(fs.existsSync('app/api/forecast-news/route.ts'));
});

console.log(`\nforecast-why: ${n} checks OK`);
