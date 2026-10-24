/**
 * «مبنای آبان‌تتر» (lib/aban/basis.ts + apply.ts, rule 102): the bots priced as Abantether prices. From the API
 * reference's own numbers: a coin's toman price = its USDT price × Abantether's USDT buy/sell; the fee 0.38%.
 * So a paper buy at the mid with cost «fee + half the spread» fills where Abantether would fill it, the server
 * refuses a basis that is stale, inverted, too wide or far from the board, and without a basis nothing changes.
 * Run: npx tsx scripts/aban-basis-test.ts
 */
import assert from 'node:assert';
import { abanQuotes, abanUsdtRial } from '../lib/aban/apply';
import { basisFrom, halfSpreadPct, perSidePct, usdtMidToman, validBasis } from '../lib/aban/basis';
import { executeOrder, SIM_ASSETS } from '../lib/engine/simulator';
import { validateSwingConfig } from '../lib/swing-live';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const NOW = Date.parse('2026-10-24T12:00:00Z');
// the reference's examples (ticker with a USDTIRT market as the live one carries; the coin list's USDT and BTC)
const TICKER = { data: { markets: { USDTIRT: { symbol: 'USDT', buy_price: '126170.0', sell_price: '125350.0', active: true }, BTCIRT: { symbol: 'BTC', buy_price: '11541360375.600000000', sell_price: '11466351138.000000000', active: true }, XRPIRT: { symbol: 'XRP', buy_price: '262625.792000', sell_price: '260477.474400', active: true }, OLDIRT: { symbol: 'OLD', buy_price: '10', sell_price: '9', active: false } } } };
const COIN_INFO = { data: { symbol: 'BTC', exchange_fee: '0.0800', irt_fee: '0.300', tether_fee: '0.300', irt: { quantity: { total: '0.9962' } } } };
const COINS = { data: [{ symbol: 'USDT', price_buy: '126170.0', price_sell: '125350.0', coin_type: 'COIN', tether_price: '1' }] };

const B = basisFrom(TICKER, NOW, COIN_INFO)!;

ok('the basis from the ticker: USDT buy/sell in toman, fee 0.38%, active coins only', () => {
  assert.deepEqual([B.usdtBuy, B.usdtSell], [126170, 125350]);
  assert.ok(Math.abs(B.feePct - 0.38) < 1e-9);
  assert.deepEqual(Object.keys(B.coins).sort(), ['BTC', 'USDT', 'XRP']);
  assert.ok(Math.abs(perSidePct(B) - (0.38 + halfSpreadPct(126170, 125350))) < 1e-12);
  assert.ok(Math.abs(perSidePct(B) - 0.706) < 0.001, `≈0.71% per side, got ${perSidePct(B)}`);
  assert.equal(abanUsdtRial(B), 1_257_600);
  // no USDTIRT in the ticker: the coin list carries it
  const noUsdt = { data: { markets: { BTCIRT: TICKER.data.markets.BTCIRT } } };
  assert.equal(basisFrom(noUsdt, NOW), null);
  assert.equal(basisFrom(noUsdt, NOW, undefined, COINS)!.usdtBuy, 126170);
  // no coin-info: the reference's fee
  assert.equal(basisFrom(TICKER, NOW)!.feePct, 0.38);
});

ok('a paper buy and sell of BTC fill where Abantether fills them (its buy/sell price, then the fee)', () => {
  const r = abanQuotes({ btc: 11_500_000_000 * 10, usd: 1_000_000 }, B);
  assert.deepEqual(r.used, ['btc', 'xrp'], 'XRP has no board quote here: Abantether\'s is taken');
  assert.equal(r.quotes.usd, 1_000_000, 'the dollar is not on Abantether: untouched');
  const mid = r.quotes.btc!;
  const cost = r.costs.btc!;
  const pos = new Map();
  const acct = { cash: 1e12, interestRial: 0, feesToman: 0 } as never as { cash: number; interestRial: number; feesToman: number };
  const prof = { minStop: 0.05, stopK: 2, cooldownDays: 3 } as never;
  const order = (side: 'buy' | 'sell') => ({ asset: 'btc', side, valueRial: 1e10, qtyFraction: 1, kind: 'rebalance', signal: { annVol: 0.6, ppy: 365 } }) as never;
  const buy = executeOrder(order('buy'), mid, '2026-10-24', acct as never, pos, new Map(), prof, 1e12, cost)!;
  // Abantether: the buy price in rial (toman × 10), plus its fee on top
  const abanBuy = 11541360375.6 * 10;
  assert.ok(Math.abs(buy.fill / abanBuy - 1 - 0.0038) < 2e-5, `fill ${buy.fill} vs Abantether ${abanBuy}×1.0038`);
  const sell = executeOrder(order('sell'), mid, '2026-10-25', acct as never, pos, new Map(), prof, 1e12, cost)!;
  const abanSell = 11466351138 * 10;
  assert.ok(Math.abs(sell.fill / abanSell - 1 + 0.0038) < 2e-5, `fill ${sell.fill} vs Abantether ${abanSell}×0.9962`);
});

ok('without a basis the engine is unchanged: no override = each asset\'s own cost', () => {
  const pos = new Map();
  const acct = { cash: 1e12, interestRial: 0, feesToman: 0 };
  const o = { asset: 'btc', side: 'buy', valueRial: 1e10, signal: { annVol: 0.6, ppy: 365 } } as never;
  const f = executeOrder(o, 1e9, '2026-10-24', acct as never, pos, new Map(), { minStop: 0.05, stopK: 2 } as never, 1e12)!;
  assert.equal(f.fill, 1e9 * (1 + SIM_ASSETS.find((a) => a.key === 'btc')!.cost));
  const g = executeOrder(o, 1e9, '2026-10-24', acct as never, new Map(), new Map(), { minStop: 0.05, stopK: 2 } as never, 1e12, 0.9)!;
  assert.equal(g.fill, f.fill, 'an absurd override is ignored');
});

ok('the server refuses a basis that is stale, inverted, too wide, far from the board; bad coins are dropped', () => {
  const sent = JSON.parse(JSON.stringify(B));
  assert.ok(validBasis(sent, NOW, 125_000));
  assert.equal(validBasis({ ...sent, at: NOW - 7 * 3_600_000 }, NOW), null, 'older than 6 hours');
  assert.equal(validBasis({ ...sent, usdtBuy: 120000, usdtSell: 126000 }, NOW), null, 'buy below sell');
  assert.equal(validBasis({ ...sent, usdtBuy: 140000 }, NOW), null, 'a 5.5% half-spread');
  assert.equal(validBasis({ ...sent, feePct: 3 }, NOW), null);
  assert.equal(validBasis(sent, NOW, 90_000), null, 'more than 25% from the board\'s tether');
  assert.equal(validBasis('junk', NOW), null);
  const v = validBasis({ ...sent, coins: { ...sent.coins, BAD: { buy: 1, sell: 2 }, 'x;y': { buy: 2, sell: 1 } } }, NOW)!;
  assert.deepEqual(Object.keys(v.coins).sort(), ['BTC', 'USDT', 'XRP']);
});

ok('a coin far from the board\'s own quote keeps the board\'s price and cost', () => {
  const r = abanQuotes({ btc: 5_000_000_000 * 10, xrp: 2_610_000 }, B);
  assert.deepEqual(r.used, ['xrp'], 'BTC 57% off the board: not used; XRP within 1%: used');
  assert.equal(r.costs.btc, undefined);
  assert.equal(r.quotes.btc, 5_000_000_000 * 10);
});

ok('swing: the session keeps its basis and the USDT rate and fee it ran on', () => {
  const cfg = validateSwingConfig({ coins: [{ id: 'bitcoin', symbol: 'BTC' }], capitalToman: 1e8, hours: 72, preset: 'trend', feePct: 0.71, priceBasis: 'aban' }, Math.round(usdtMidToman(B) * 10), 720);
  assert.equal(cfg.priceBasis, 'aban');
  assert.equal(cfg.feePct, 0.71);
  assert.equal(cfg.usdtRial, 1_257_600);
  assert.equal(validateSwingConfig({ coins: [{ id: 'bitcoin' }], capitalToman: 1e8, hours: 72, priceBasis: 'evil' }, null, 720).priceBasis, undefined);
});

// the device side: an unreachable exchange is not asked again on every bot tick; the page's button reads now
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
let calls = 0;
let reachable = false;
void (async () => {
globalThis.fetch = (async () => {
  calls++;
  if (!reachable) throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify(TICKER), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const { currentBasis, setBasisOn } = await import('../lib/aban/basis-store');
const T0 = NOW;
assert.equal(await currentBasis(T0), null);
assert.equal(calls, 1);
assert.equal(await currentBasis(T0 + 5 * 60_000), null, 'within half an hour: not asked again');
assert.equal(calls, 1);
reachable = true;
const forced = await currentBasis(T0 + 6 * 60_000, true);
assert.equal(forced?.usdtBuy, 126170, 'the button reads now');
assert.ok(calls >= 2);
const c2 = calls;
assert.equal((await currentBasis(T0 + 8 * 60_000))?.usdtBuy, 126170, 'fresh: kept, not read again');
assert.equal(calls, c2);
reachable = false;
assert.equal((await currentBasis(T0 + 20 * 60_000))?.usdtBuy, 126170, 'unreachable again: the last one within six hours');
assert.equal((await currentBasis(T0 + 25 * 60_000))?.usdtBuy, 126170);
assert.equal(calls, c2 + 1, 'and not asked again for half an hour');
setBasisOn(false);
assert.equal(await currentBasis(T0 + 26 * 60_000, true), null, 'off: no basis, nothing sent');
assert.equal(calls, c2 + 1);
n++;
console.log('✓ the device: an unreachable exchange waits half an hour, the button forces a read, off = nothing');

console.log(`\n${n} aban-basis checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
