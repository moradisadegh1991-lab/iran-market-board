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
(globalThis as any).fetch = async (input: string | URL) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('tgju')) return json({ current: { price_dollar_rl: { p: '1,050,000', dp: '0.5', dt: 'high' }, sekee: { p: '980,000,000', dp: '1.1', dt: 'low' }, geram18: { p: '95,000,000', dp: '0.3', dt: 'high' }, ons: { p: '3,650.12', dp: '0.2', dt: 'low' } } });
  if (url.includes('gold-api')) return json({ price: 3650 });
  if (url.includes('udf/history')) return json({ s: 'ok', t: udf.map((_, i) => Math.floor((now - (419 - i) * DAY) / 1000)), c: udf });
  if (url.includes('nobitex') && url.includes('dstCurrency=rls,usdt')) return json({ status: 'ok', stats: { 'usdt-rls': { latest: '1060000', dayChange: '0.4' }, 'btc-usdt': { latest: '112000', dayChange: '-1.2' }, 'eth-usdt': { latest: '4200', dayChange: '2.1' } } });
  if (url.includes('nobitex')) return json({ status: 'ok', stats: { 'c3-rls': { latest: '10' }, 'mem2-rls': { latest: '5' }, 'c5-rls': { isClosed: true } } });
  if (url.includes('Index.php')) return json({ data: [{ name: 'شاخص کل (هم وزن)', value: '800000' }, { name: 'شاخص کل', value: '2450000', change_percent: '0.8' }] });
  if (url.includes('AllSymbols.php')) return json(symbols);
  if (url.includes('market_chart')) {
    const p = gbm(366, 30000, 0.001, 0.025);
    return json({ prices: p.map((v, i) => [now - (365 - i) * DAY, v]) });
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
  assert.equal(s.crypto.coins.length, 10);
  assert.equal(s.crypto.memes.length, 10);
  assert.ok(!s.crypto.coins.some((c) => c.symbol === 'USDT' || /wrapped/i.test(c.name)), 'stable/wrapped excluded');
  assert.equal(s.stocks.mode, 'history');
  assert.equal(s.stocks.rows.length, 10);
  for (const prof of Object.values(s.portfolios))
    for (const p of Object.values(prof)) {
      const sum = p.lines.reduce((a, l) => a + l.weight, 0);
      assert.ok(Math.abs(sum - 1) < 0.011, `weights sum ${sum}`);
      assert.ok(p.lines.every((l) => l.weight >= 0));
    }
  assert.equal(s.portfolios.conservative.y1.lines.find((l) => l.cls === 'spec')!.weight, 0);

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
  console.log('\n--- sample telegram (risk) ---\n' + f.riskMsg(s)[0].slice(0, 700));
  console.log('\nSMOKE OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
