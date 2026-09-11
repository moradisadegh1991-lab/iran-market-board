// Offline test for the trading simulator. Run: npm run smoke:sim
import assert from 'node:assert/strict';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
/** GBM with regime changes so the trader meets both trends and chop */
function regimes(n: number, start: number, sigma: number, drifts: number[]) {
  const out = [start];
  for (let i = 1; i < n; i++) {
    const mu = drifts[Math.floor((i / n) * drifts.length)];
    out.push(out[i - 1] * Math.exp(mu - sigma ** 2 / 2 + sigma * gauss()));
  }
  return out;
}
const DAY = 86400000;
const now = Date.now();
const isoDay = (msAgo: number) => new Date(now - msAgo).toISOString().slice(0, 10);

const tgjuRows = (p: number[]) => p.map((v, i) => [String(v), String(v), String(v), Math.round(v).toLocaleString('en-US'), '1', '0.1%', isoDay((p.length - 1 - i) * DAY).replace(/-/g, '/'), '1405/01/01']).reverse();
const N = 470;
const hist: Record<string, number[]> = {
  price_dollar_rl: regimes(N, 700_000, 0.012, [0.002, 0.0005, 0.003, -0.001, 0.0015]),
  sekee: regimes(N, 500_000_000, 0.015, [0.002, -0.001, 0.003, 0.0, 0.002]),
  geram18: regimes(N, 50_000_000, 0.013, [0.0015, 0.0, 0.0025, 0.0005, 0.002]),
  ons: regimes(N, 2400, 0.009, [0.001, 0.0005, 0.0012, 0.0, 0.001]),
};
const tse = regimes(320, 2_000_000, 0.011, [0.003, -0.002, 0.001, 0.004]);

const rss = (items: { title: string; source: string; ms: number }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map((i) => `<item><title>${i.title.replace(/&/g, '&amp;')} - ${i.source}</title><link>https://news.example/${Math.round(i.ms)}</link><pubDate>${new Date(i.ms).toUTCString()}</pubDate><source url="https://x">${i.source}</source></item>`)
    .join('')}</channel></rss>`;
const HEADLINES: Record<string, string[]> = {
  fa: ['شکست مذاکرات و بازگشت تحریم‌ها؛ دلار جهش کرد', 'توافق هسته‌ای نزدیک است؛ رفع تحریم در دستور کار', 'بورس سبز شد؛ شاخص کل رکورد زد', 'قیمت طلا و سکه امروز کاهش یافت', 'حمله هوایی و تنش نظامی در منطقه', 'آتش بس اعلام شد', 'خبر بی‌ربط درباره هوا'],
  en: ['Fed signals rate cuts as inflation cools', 'Bitcoin ETF inflows hit record', 'Crypto exchange hacked, $400m stolen', 'Gold slumps as dollar index rises', 'Weather is nice today'],
};

let googleCalls = 0;
(globalThis as any).fetch = async (input: string | URL) => {
  const url = String(input);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('summary-table-data/')) {
    const slug = url.split('summary-table-data/')[1];
    return hist[slug] ? json({ data: tgjuRows(hist[slug]) }) : new Response('nf', { status: 404 });
  }
  if (url.includes('GetIndexB2History')) return json({ indexB2: tse.map((v, i) => ({ dEven: Number(isoDay((319 - i) * 1.4 * DAY).replace(/-/g, '')), xNivInuClMresIbs: v })) });
  if (url.includes('market_chart')) {
    const p = regimes(366, url.includes('pax') ? 2400 : url.includes('ethereum') ? 2500 : 40000, url.includes('pax') ? 0.009 : 0.03, [0.003, -0.002, 0.004, 0.0]);
    return json({ prices: p.map((v, i) => [now - (365 - i) * DAY, v]) });
  }
  if (url.includes('news.google.com')) {
    googleCalls++;
    const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
    const after = /after:(\S+)/.exec(q)![1], before = /before:(\S+)/.exec(q)![1];
    const lang = url.includes('hl=fa') ? 'fa' : 'en';
    const a = Date.parse(`${after}T00:00:00Z`), b = Date.parse(`${before}T00:00:00Z`);
    const items = Array.from({ length: 12 }, () => ({ title: HEADLINES[lang][Math.floor(rnd() * HEADLINES[lang].length)], source: lang === 'fa' ? 'ایسنا' : 'Reuters', ms: a + rnd() * (b - a) }));
    return new Response(rss(items), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  }
  if (url.includes('nobitex')) return new Response('Forbidden', { status: 403 });
  return new Response('not found', { status: 404 });
};

(async () => {
  // 1) parsers + lexicon
  const { parseGoogleNewsRss } = await import('@/lib/sources/news');
  const parsed = parseGoogleNewsRss(rss([{ title: 'Gold & silver rally', source: 'Reuters', ms: Date.UTC(2026, 0, 5, 9) }]), 'en');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Gold & silver rally', 'source suffix stripped, entity decoded');
  const { scoreHeadline } = await import('@/lib/news');
  const sanc = scoreHeadline('شکست مذاکرات و بازگشت تحريم‌ها؛ دلار جهش كرد')!; // Arabic ي/ك on purpose
  assert.ok(sanc.effects.usd! > 0.5 && sanc.effects.tse! < 0, JSON.stringify(sanc));
  const deal = scoreHeadline('توافق هسته‌ای نزدیک است؛ رفع تحریم در دستور کار')!;
  assert.ok(deal.effects.usd! < 0 && deal.effects.tse! > 0, JSON.stringify(deal));
  assert.ok(scoreHeadline('Crypto exchange hacked, $400m stolen')!.effects.eth! < 0);
  assert.equal(scoreHeadline('Weather is nice today'), null);

  // 2) engine invariants on synthetic data with a planted future headline
  const { simulate, PROFILES } = await import('@/lib/engine/simulator');
  const mk = (n: number, start: number, sigma: number, drifts: number[]) => {
    const p = regimes(n, start, sigma, drifts);
    return { dates: p.map((_, i) => isoDay((n - 1 - i) * DAY)), prices: p };
  };
  const series = {
    usd: { key: 'usd' as const, ...mk(400, 800_000, 0.012, [0.002, -0.001, 0.003, 0.0]), basis: 'test', reconstructed: false },
    g18: { key: 'g18' as const, ...mk(400, 60_000_000, 0.013, [0.001, 0.002, -0.002, 0.003]), basis: 'test', reconstructed: false },
    btc: { key: 'btc' as const, ...mk(400, 4e10, 0.03, [0.004, -0.004, 0.005, -0.001]), basis: 'test', reconstructed: true },
  };
  const start = isoDay(300 * DAY), end = isoDay(5 * DAY);
  const futureMs = now - 100 * DAY;
  const news = [
    { id: 'future', date: isoDay(100 * DAY), ms: futureMs, title: 'تحریم جدید', source: 'test', url: '', effects: { usd: 1, g18: 0.6 }, facts: ['تشدید تحریم'], weight: 1 },
    ...Array.from({ length: 80 }, (_, i) => {
      const ms = now - (290 - i * 3.5) * DAY;
      return { id: `n${i}`, date: new Date(ms).toISOString().slice(0, 10), ms, title: `خبر ${i}`, source: 'test', url: '', effects: { usd: i % 3 ? 0.8 : -0.8, btc: i % 4 ? 0.6 : -0.6 }, facts: ['آزمایش'], weight: i % 5 ? 0.4 : 1 };
    }),
  ];
  for (const profile of Object.keys(PROFILES) as (keyof typeof PROFILES)[]) {
    const r = simulate({ start, end, capitalToman: 500_000_000, profile, assets: ['usd', 'g18', 'btc'], fixedIncomeYield: 0.3, series, news });
    assert.ok(r.trades.length > 0, `${profile}: trader made no trades`);
    for (const t of r.trades) {
      assert.ok(t.date > t.decisionDate, `fill after decision (#${t.n})`);
      const cutoff = Date.parse(`${t.decisionDate}T12:30:00Z`);
      for (const n of t.news) {
        const src = news.find((x) => x.id === n.id)!;
        assert.ok(src.ms <= cutoff, `look-ahead: trade #${t.n} on ${t.decisionDate} cites news from ${src.date}`);
      }
      assert.ok(t.reasons.length > 0 && t.valueToman > 0 && t.feeToman >= 0, `trade #${t.n} fields`);
    }
    for (const e of r.equity) {
      assert.ok(e.cash >= -1, `negative cash ${e.cash} on ${e.date}`);
      assert.ok(Math.abs(e.equity - e.cash - e.invested) < 1, 'equity = cash + invested');
    }
    const m = r.metrics;
    for (const k of ['finalEquity', 'returnPct', 'maxDrawdownPct', 'feesToman', 'interestToman'] as const) assert.ok(Number.isFinite(m[k]), `${profile}.${k}`);
    assert.ok(m.maxDrawdownPct <= 0);
    assert.ok(r.benchmarks.some((b) => b.key === 'deposit') && r.analysis.length >= 4);
    const realizedSum = r.attribution.reduce((s, a) => s + a.realizedToman + a.unrealizedToman, 0);
    const identity = m.finalEquity - m.startEquity - m.interestToman - realizedSum;
    assert.ok(Math.abs(identity) < m.startEquity * 1e-6, `P&L identity off by ${identity}`);
    console.log(`${PROFILES[profile].label}: trades ${m.trades} (stops ${m.stops}, news-driven ${m.newsDrivenTrades}) return ${m.returnPct.toFixed(1)}% maxDD ${m.maxDrawdownPct.toFixed(1)}% fees ${Math.round(m.feesToman).toLocaleString()} exposure ${m.avgExposurePct.toFixed(0)}%`);
  }

  // 3) full pipeline: real adapters against mocked TGJU / CoinGecko / TSETMC / Google News
  const { runSimulation, validate, getCoverage } = await import('@/lib/simulate');
  const cov = await getCoverage();
  assert.ok(cov.earliestStart && cov.latestEnd, JSON.stringify(cov));
  assert.throws(() => validate({ start: '2026-01-10', end: '2026-01-05', capitalToman: 1e8, assets: ['usd'] }));
  const req = validate({ start: isoDay(200 * DAY), end: isoDay(2 * DAY), capitalToman: 1_000_000_000, profile: 'balanced', assets: ['usd', 'g18', 'coin', 'tse', 'btc', 'eth'], useNews: true });
  const t0 = Date.now();
  const res = await runSimulation(req);
  const ms = Date.now() - t0;
  assert.ok(res.news.items > 0 && res.news.chunksLoaded === res.news.chunksTotal, JSON.stringify(res.news));
  assert.ok(res.trades.length > 0 && res.equity.length > 100);
  const callsAfterFirst = googleCalls;
  const again = await runSimulation(req);
  assert.equal(again.cached, true, 'second identical run served from cache');
  assert.equal(googleCalls, callsAfterFirst, 'no news refetch on cached run');
  const json = JSON.stringify(res);
  console.log(`pipeline: ${ms} ms, ${res.trades.length} trades, ${res.news.items} scored news from ${res.news.chunksTotal} monthly chunks, payload ${(json.length / 1024).toFixed(0)} KB`);
  console.log('coverage:', cov.assets.map((a) => `${a.key}:${a.points}`).join(' '), 'earliest', cov.earliestStart);
  console.log('return', res.metrics.returnPct.toFixed(1), '% vs', res.benchmarks.map((b) => `${b.label}=${b.returnPct.toFixed(1)}`).join(' | '));
  const sample = res.trades.find((t) => t.news.length) ?? res.trades[0];
  console.log('\nsample trade:', JSON.stringify({ ...sample, news: sample.news.slice(0, 2) }, null, 1).slice(0, 1400));
  console.log('\nanalysis:\n' + res.analysis.map((a) => `■ ${a.title}: ${a.body}`).join('\n'));
  console.log('\nwarnings:', res.warnings);
  console.log('\nSIM SMOKE OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
