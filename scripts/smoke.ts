// Offline smoke test: mocks every external API, runs the full snapshot pipeline on the in-memory store,
// then checks invariants and Telegram message sizes.  Run: npm run smoke
import assert from 'node:assert/strict';

process.env.BRSAPI_KEY = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
function gbm(n: number, start: number, mu: number, sigma: number) {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * Math.exp(mu - sigma ** 2 / 2 + sigma * gauss()));
  return out;
}
const DAY = 86400000;
const now = Date.now();

const cgCoin = (i: number, meme: boolean) => {
  const spark = gbm(168, 10 * (1 + i), (rnd() - 0.45) * 0.004, meme ? 0.03 : 0.012);
  const price = spark[spark.length - 1];
  return {
    id: `${meme ? 'meme' : 'coin'}-${i}`, symbol: meme ? `mem${i}` : i === 0 ? 'usdt' : `c${i}`, name: meme ? `Meme ${i}` : i === 1 ? 'Wrapped Thing' : `Coin ${i}`,
    current_price: i === 0 && !meme ? 1.0 : price, market_cap: (meme ? 5e8 : 5e10) / (i + 1), total_volume: (meme ? 8e7 : 2e9) * rnd() / (i + 1) + 3e6,
    price_change_percentage_24h_in_currency: (rnd() - 0.5) * (meme ? 40 : 12), price_change_percentage_7d_in_currency: (spark[167] / spark[0] - 1) * 100,
    price_change_percentage_30d_in_currency: i === 0 && !meme ? 0.1 : (rnd() - 0.4) * 60, sparkline_in_7d: { price: spark },
  };
};
const symbols = Array.from({ length: 520 }, (_, i) => {
  const pc = 1000 + Math.round(rnd() * 20000);
  return { l18: `نماد${String.fromCharCode(0x0627 + (i % 30))}${String.fromCharCode(0x0628 + ((i * 7) % 25))}${i % 3 ? 'ک' : 'م'}`, l30: i % 50 === 0 ? 'صندوق طلا' : `شرکت ${i}`,
    pl: String(pc), pc: String(pc), pcp: String((rnd() - 0.45) * 6), plp: String((rnd() - 0.45) * 6), tno: String(Math.round(rnd() * 3000)),
    tvol: String(Math.round(rnd() * 5e7)), tval: String(Math.round(rnd() * 3e11)), mv: String(Math.round(rnd() * 5e14)), pe: String((rnd() - 0.1) * 30), tmax: String(pc * 1.05) };
}).map((s) => ({ ...s, l18: s.l18.replace(/[0-9]/g, '') + Math.random().toString(36).slice(2, 4).replace(/[0-9]/g, 'x') }));

const udf = gbm(420, 900000, 0.0012, 0.012);
const isoDay = (msAgo: number) => new Date(now - msAgo).toISOString().slice(0, 10);
// TGJU summary-table-data rows: [open, low, high, close, change, change%, 'YYYY/MM/DD', jalali], newest first
const tgjuRows = (start: number, mu: number, sigma: number, n = 470) => {
  const p = gbm(n, start, mu, sigma);
  return p.map((v, i) => [String(v), String(v), String(v), Math.round(v).toLocaleString('en-US'), '<span class="low">1</span>', '<span>0.1%</span>', isoDay((n - 1 - i) * DAY).replace(/-/g, '/'), '1405/01/01']).reverse();
};
const tgjuHist: Record<string, unknown[]> = {
  price_dollar_rl: tgjuRows(1_000_000, 0.0012, 0.013),
  sekee: tgjuRows(900_000_000, 0.0013, 0.016),
  geram18: tgjuRows(90_000_000, 0.0012, 0.014),
  ons: tgjuRows(2600, 0.0008, 0.009),
};
const tseIdxHist = gbm(300, 2_000_000, 0.0015, 0.011);
(globalThis as any).fetch = async (input: string | URL) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('summary-table-data/')) {
    const slug = url.split('summary-table-data/')[1];
    return tgjuHist[slug] ? json({ recordsTotal: 470, data: tgjuHist[slug] }) : new Response('nf', { status: 404 });
  }
  if (url.includes('cdn.tsetmc.com/api/Index/GetIndexB2History'))
    return json({ indexB2: tseIdxHist.map((v, i) => ({ dEven: Number(isoDay((299 - i) * 1.4 * DAY).replace(/-/g, '')), xNivInuClMresIbs: v })) });
  if (url.includes('Market/Gold_Currency'))
    return json({ gold: [], currency: [], cryptocurrency: [{ symbol: 'USDT', name: 'تتر', price: 106500, change_percent: 0.2 }] });
  // Nobitex is blocked from Vercel in production — simulate that so every fallback path is exercised
  if (url.includes('nobitex')) return new Response('Forbidden', { status: 403 });
  if (url.includes('tgju')) return json({ current: { price_dollar_rl: { p: '1,050,000', dp: '0.5', dt: 'high' }, sekee: { p: '980,000,000', dp: '1.1', dt: 'low' }, geram18: { p: '95,000,000', dp: '0.3', dt: 'high' }, ons: { p: '3,650.12', dp: '0.2', dt: 'low' } } });
  if (url.includes('gold-api')) return json({ price: 3650 });
  if (url.includes('Index.php')) return json({ data: [{ name: 'شاخص کل (هم وزن)', value: '800000' }, { name: 'شاخص کل', value: '2450000', change_percent: '0.8' }] });
  if (url.includes('AllSymbols.php')) return json(symbols);
  if (url.includes('market_chart')) {
    const days = Number(/days=(\d+)/.exec(url)?.[1] ?? 365);
    const n = days === 1 ? 288 : days === 7 ? 168 : 366;
    const step = days === 1 ? 300_000 : days === 7 ? 3_600_000 : DAY;
    const p = gbm(n, 30000, 0.0005, days === 365 ? 0.025 : 0.004);
    return json({ prices: p.map((v, i) => [now - (n - 1 - i) * step, v]) });
  }
  if (url.includes('category=meme-token')) return json(Array.from({ length: 120 }, (_, i) => cgCoin(i, true)));
  if (url.includes('/coins/markets')) return json(Array.from({ length: 250 }, (_, i) => cgCoin(i, false)));
  if (url.includes('api.telegram.org')) return json({ ok: true, result: {} });
  return new Response('not found', { status: 404 });
};

(async () => {
  const { loadDaily, saveDaily, upsertDailyPoint, loadTse, saveTse, mergeTseBackfill } = await import('@/lib/history');
  const { tehranDate } = await import('@/lib/num');

  // pre-seed 70 days of TSE index + per-symbol history (simulates backfill script)
  const daily = await loadDaily();
  const idx = gbm(70, 2e6, 0.001, 0.012);
  idx.forEach((v, i) => upsertDailyPoint(daily, tehranDate(new Date(now - (70 - i) * DAY)), { tse: v }));
  await saveDaily(daily);
  const tse = await loadTse();
  const back: Record<string, { date: string; close: number; value: number }[]> = {};
  for (const s of symbols.slice(0, 300)) {
    const c = gbm(45, Number(s.pc), (rnd() - 0.4) * 0.01, 0.025);
    back[s.l18] = c.map((v, i) => ({ date: tehranDate(new Date(now - (45 - i) * DAY)), close: Math.round(v), value: 2e10 + rnd() * 2e11 }));
  }
  const merged = mergeTseBackfill(tse, back);
  await saveTse(tse);

  const { getSnapshot } = await import('@/lib/snapshot');
  const t0 = Date.now();
  const s = await getSnapshot({ force: true });
  const ms = Date.now() - t0;

  assert.equal(s.live.items.length, 8);
  assert.ok(s.live.coinBubblePct! > 5 && s.live.coinBubblePct! < 12, `coin bubble ${s.live.coinBubblePct}`);
  for (const a of s.risk) {
    for (const [h, r] of Object.entries(a.horizons)) {
      if (!r) continue;
      for (const k of ['buy', 'hold', 'sell'] as const) assert.ok(r[k] >= 0 && r[k] <= 100, `${a.key}.${h}.${k}=${r[k]}`);
      assert.ok(r.rangeLow < r.rangeHigh);
    }
  }
  const usd = s.risk.find((r) => r.key === 'usd')!;
  assert.ok(usd.horizons.y1, 'usd yearly risk should exist via proxy history');
  assert.ok(s.risk.find((r) => r.key === 'tse')!.horizons.m1, 'tse monthly risk from seeded index');
  assert.ok(s.crypto.coins.length >= 10 && s.crypto.coins.length <= 25, `coins ${s.crypto.coins.length}`);
  assert.ok(s.crypto.memes.length >= 10, `memes ${s.crypto.memes.length}`);
  // no asset may be stuck on "1 day of data" even though Nobitex is blocked
  for (const k of ['usd', 'usdt', 'g18', 'coin', 'ons', 'btc', 'eth', 'tse']) {
    const a = s.risk.find((r) => r.key === k)!;
    assert.ok(a.points >= 200, `${k} history points ${a.points} (basis ${a.basis})`);
  }
  const usdtItem = s.live.items.find((i) => i.key === 'usdt')!;
  assert.ok(usdtItem.price && usdtItem.price > 90000 && usdtItem.price < 130000, `usdt via BrsApi fallback ${usdtItem.price}`);
  // scenarios
  const sc = s.scenarios.assets;
  for (const k of ['usd', 'g18', 'coin', 'ons', 'btc', 'tse']) assert.ok(sc.find((a) => a.key === k), `scenario ${k}`);
  assert.equal(sc.filter((a) => a.group === 'alt').length, 3, 'three altcoin scenarios');
  for (const a of sc) {
    for (const [h, r] of Object.entries(a.rows)) {
      if (!r) continue;
      assert.ok(r.worst > 0 && r.worst < r.base && r.base < r.best, `${a.key}.${h} ordering ${r.worst} ${r.base} ${r.best}`);
      assert.ok(r.worstPct > -100 && r.bestPct > 0, `${a.key}.${h} pct ${r.worstPct} ${r.bestPct}`);
      if (h !== 'y1') assert.ok(r.worstPct < 0, `${a.key}.${h} worst case should be a loss: ${r.worstPct}`);
    }
    assert.ok(a.rows.y1 && a.rows.d1, `${a.key} has 1d and 1y rows (${a.missingReason ?? ''})`);
    assert.ok(a.drivers.length >= 3 && a.summary.length > 20, `${a.key} reasoning`);
  }
  const widen = (k: string) => sc.find((a) => a.key === k)!.rows;
  assert.ok(widen('usd').y1!.bestPct > widen('usd').m1!.bestPct, 'longer horizon → wider range');
  assert.ok(!s.crypto.coins.some((c) => c.symbol === 'USDT' || /wrapped/i.test(c.name)), 'stable/wrapped excluded');
  assert.equal(s.stocks.mode, 'history');
  assert.ok(s.stocks.rows.length >= 10, `stocks ${s.stocks.rows.length}`);
  for (const prof of Object.values(s.portfolios))
    for (const p of Object.values(prof)) {
      const sum = p.lines.reduce((a, l) => a + l.weight, 0);
      assert.ok(Math.abs(sum - 1) < 0.011, `weights sum ${sum}`);
      assert.ok(p.lines.every((l) => l.weight >= 0));
    }
  assert.equal(s.portfolios.conservative.y1.lines.find((l) => l.cls === 'spec')!.weight, 0);

  const { getChart } = await import('@/lib/chart');
  const c1y = await getChart('usd', '1y');
  assert.equal(c1y.resolution, 'daily');
  assert.ok(c1y.points.length > 300 && c1y.stats, `usd 1y chart ${c1y.points.length}`);
  assert.ok(c1y.stats!.last > 90000 && c1y.stats!.last < 130000, `chart in toman ${c1y.stats!.last}`);
  const c1d = await getChart('g18', '1d');
  assert.ok(c1d.note && c1d.points.length >= 5, 'rial 1d chart falls back to daily with a note until intraday accumulates');
  const cbtc = await getChart('btc', '1d');
  assert.equal(cbtc.resolution, 'intraday');
  const alt = sc.find((a) => a.group === 'alt')!;
  const calt = await getChart(`cg:${alt.key.slice(4)}`, '3m');
  assert.ok(calt.points.length > 60, 'altcoin 3m chart');

  const cached = await getSnapshot();
  assert.equal(cached.generatedAt, s.generatedAt, 'second call served from cache');

  const f = await import('@/lib/telegram/format');
  const msgs = f.fullReport(s);
  const lens = msgs.map((m) => m.length);
  assert.ok(lens.every((l) => l < 4096), `telegram lengths ${lens}`);

  const { handleUpdate } = await import('@/lib/telegram/handler');
  await handleUpdate({ message: { chat: { id: 1 }, text: '/start' } });
  await handleUpdate({ message: { chat: { id: 1 }, text: '🧺 سبد دارایی' } });

  console.log(`build ${ms} ms · backfill points ${merged} · telegram messages ${msgs.length} (max ${Math.max(...lens)} chars)`);
  console.log('sources:', s.sources.map((x) => `${x.name}:${x.ok ? 'ok' : 'FAIL'}`).join(' '));
  console.log('usd risk:', JSON.stringify(Object.fromEntries(Object.entries(usd.horizons).map(([k, v]) => [k, v && [v.buy, v.hold, v.sell, +v.confidence.toFixed(2)]]))));
  console.log('coin risk m1:', JSON.stringify(s.risk.find((r) => r.key === 'coin')!.horizons.m1));
  console.log('top coins:', s.crypto.coins.slice(0, 3).map((c) => `${c.symbol}:${c.score}:${c.onNobitex}`).join(' '));
  console.log('top stocks:', s.stocks.rows.slice(0, 3).map((r) => `${r.symbol}:${r.score}`).join(' '));
  console.log('balanced m3:', s.portfolios.balanced.m3.lines.map((l) => `${l.cls}=${l.weight}`).join(' '), 'vol', s.portfolios.balanced.m3.annualVolPct?.toFixed(1));
  const tseSc = sc.find((a) => a.key === 'tse')!;
  console.log('tse scenario:', Object.values(tseSc.rows).map((r) => r && `${r.label}: ${r.worstPct.toFixed(1)} / ${r.basePct.toFixed(1)} / ${r.bestPct.toFixed(1)}`).join(' | '));
  console.log('tse drivers:\n - ' + tseSc.drivers.join('\n - '));
  console.log('usd basis:', s.risk.find((r) => r.key === 'usd')!.basis, '· tse basis:', s.risk.find((r) => r.key === 'tse')!.basis);
  console.log('\n--- sample telegram (scenarios) ---\n' + (f.scenariosMsg ? f.scenariosMsg(s)[0].slice(0, 900) : '(none)'));
  console.log('\nSMOKE OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
