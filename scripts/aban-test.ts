/**
 * آبان‌تتر (lib/aban, rule 101), against the examples of the API reference (docs.abantether.com), copied as they are:
 * the ticker's markets with buy = what the user pays, the coin list with its boxes (FUND), coin-info fees and limits,
 * balances, orders whose volume is an object and whose BUY volume is in the quote, statuses, the order body and its
 * warnings, balances into the book's assets — and, for real money, that a request is sent exactly once, with the
 * key as the docs say («Authorization: <key>») and nowhere but api.abantether.com. A fake fetch plays the exchange.
 * Run: npx tsx scripts/aban-test.ts
 */
import assert from 'node:assert';
import { abanApi, loadKey, saveKey } from '../lib/aban/client';
import { assetsFromBalances, isOpenOrder, num, orderBody, orderChecks, parseBalances, parseCoinInfo, parseCoins, parseOrders, parseTicker } from '../lib/aban/parse';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};

// ── the docs' examples ──
const TICKER = { data: { markets: { XRPIRT: { symbol: 'XRP', buy_price: '262625.792000', sell_price: '260477.474400', buy_max: '10000.00', sell_max: '10000.00', active: true }, BTCIRT: { symbol: 'BTC', buy_price: '11717760000.000000000', sell_price: '11621907000.000000000', buy_max: '65000.00', sell_max: '65000.00', active: true }, CAKEIRT: { symbol: 'CAKE', buy_price: '292236.800000000', sell_price: '289846.260000000', buy_max: '6000.00', sell_max: '6000.00', active: true } } } };
const COINS = { data: [{ id: 1, name: 'Tether USDt', symbol: 'USDT', persian_name: 'تتر', is_active: true, is_withdrawal_active: true, is_deposit_active: true, is_buy_active: true, is_sell_active: true, min_trade: '1.00', max_trade: '100000.00', tether_price: '1', price_buy: '126170.0', price_sell: '125350.0', percent_change_24h: '-0.00', coin_type: 'COIN', exchange_type: 'fake' }, { id: 2, name: 'Bitcoin', symbol: 'BTC', persian_name: 'بیت کوین', is_active: true, is_buy_active: true, is_sell_active: true, tether_price: '91474.68000000', price_buy: '11541360375.600000000', price_sell: '11466351138.000000000', percent_change_24h: '2.87', coin_type: 'COIN', exchange_type: 'binance' }] };
const COIN_INFO = { data: { symbol: 'LINK', persian_name: 'چین لینک', exchange_fee: '0.0800', usdt_min_trade: '11.00', usdt_max_trade: '5000.00', irt_min_trade: '913000.000', irt_max_trade: '415000000.000', irt_fee: '0.300', tether_fee: '0.300', usdt: { quantity: { universal_price_coefficient: '1', exchange_fee_coefficient: '0.0008', aban_fee_coefficient: '0.003', total: '0.9962' } }, irt: { quantity: { universal_price_coefficient: '1', exchange_fee_coefficient: '0.0008', aban_fee_coefficient: '0.003', total: '0.9962' } } } };
const BALANCES = { data: [{ asset: { symbol: 'USDT', asset_type: 'COIN' }, symbol: 'USDT', balance: '188.000994', available: '188.000994', blocked: '-0.00000000000000000000', debit: '0.0', banned: '0.0' }, { asset: { symbol: 'XRP', asset_type: 'COIN' }, symbol: 'XRP', balance: '36.0', available: '36.0', blocked: '-0.00000000000000000000', debit: '0.0', banned: '0.0' }] };
const ORDER = { id: '6720a893239459d8b5b6b8cd', code: '23120148686', base_symbol: 'TON', quote_symbol: 'IRT', side: 'buy', type: 'market', status: 'new', volume: { base: '0.0', quote: '1200000.00' }, filled_volume: { base: '0.0', quote: '0.0' }, created_at: '2024-10-29 09:19:15', finalized_at: null, price: null, coin_price: '5.018', usdt_price: '68530.00' };
const ORDERS = { data: [{ ...ORDER, status: 'rejected' }, { ...ORDER, id: '67209b20520dc40c8e91dddc', type: 'limit', status: 'open', price: '10.00' }], page: 1, per_page: 10, page_count: 1, total: 2 };

// a browser-ish environment and a fake exchange
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
type Req = { url: string; method: string; auth: string | null; body: string | null };
let log: Req[] = [];
let route: (r: Req) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
(globalThis as Record<string, unknown>).fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
  const r: Req = { url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body ?? null };
  log.push(r);
  const res = route(r);
  if (res.status < 0) throw new TypeError('Failed to fetch');
  return { status: res.status, text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) };
};

(async () => {
  await ok('numbers: strings with separators, Persian digits, «-0.000…» is zero; junk is not a number', () => {
    assert.equal(num('1,234,500'), 1234500);
    assert.equal(num('۱۲۳٫۵'), 123.5);
    assert.equal(num('-0.00000000000000000000'), 0);
    assert.ok(!Object.is(num('-0.0'), -0));
    assert.equal(num('abc'), null);
  });

  await ok('ticker (docs): data.markets keyed BTCIRT; «buy» is what the user pays — the higher of the two', () => {
    const t = parseTicker(TICKER);
    assert.deepEqual(t.map((x) => x.symbol), ['BTC', 'CAKE', 'XRP']);
    const xrp = t.find((x) => x.symbol === 'XRP')!;
    assert.equal(xrp.quote, 'IRT');
    assert.equal(xrp.buy, 262625.792);
    assert.equal(xrp.sell, 260477.4744);
    assert.ok(xrp.buy! > xrp.sell!);
    assert.deepEqual(parseTicker('<html>'), []);
  });

  await ok('coin list (docs): a coin\'s toman price = its USDT price × the USDT toman price, buy and sell', () => {
    const c = parseCoins(COINS);
    const usdt = c.find((x) => x.symbol === 'USDT')!;
    const btc = c.find((x) => x.symbol === 'BTC')!;
    assert.equal(btc.type, 'COIN');
    assert.equal(btc.change24h, 2.87);
    // the relation the bots' Aban basis rests on (lib/aban/basis.ts)
    assert.ok(Math.abs(btc.usdt! * usdt.buy! - btc.buy!) < 1);
    assert.ok(Math.abs(btc.usdt! * usdt.sell! - btc.sell!) < 1);
  });

  await ok('coin-info (docs): fee 0.08% + 0.3% = 0.38% (= 1 − 0.9962), limits in toman and tether', () => {
    const i = parseCoinInfo(COIN_INFO)!;
    assert.ok(Math.abs(i.feePct - 0.38) < 1e-9);
    assert.deepEqual([i.minIrt, i.maxIrt, i.minUsdt, i.maxUsdt], [913000, 415000000, 11, 5000]);
    // without the percent fields, the coefficient says the same
    const j = parseCoinInfo({ data: { symbol: 'X', irt: { quantity: { total: '0.9962' } } } })!;
    assert.ok(Math.abs(j.feePct - 0.38) < 1e-9);
  });

  await ok('balances (docs): symbol, balance, available, blocked «-0.000…»', () => {
    assert.deepEqual(parseBalances(BALANCES), [
      { symbol: 'USDT', balance: 188.000994, available: 188.000994, blocked: 0 },
      { symbol: 'XRP', balance: 36, available: 36, blocked: 0 },
    ]);
  });

  await ok('orders (docs): volume and filled volume are {base, quote}; only open states can be cancelled', () => {
    const o = parseOrders(ORDERS);
    assert.equal(o.length, 2);
    assert.deepEqual([o[0].id, o[0].side, o[0].base, o[0].quote, o[0].type, o[0].volBase, o[0].volQuote, o[0].price], ['6720a893239459d8b5b6b8cd', 'buy', 'TON', 'IRT', 'market', 0, 1200000, null]);
    assert.equal(o[1].price, 10);
    assert.ok(!isOpenOrder(o[0]), 'rejected');
    assert.ok(isOpenOrder(o[1]), 'open');
    for (const s of ['new', 'processing', 'fee_calculated', 'accounting_blocked']) assert.ok(isOpenOrder({ status: s }));
    for (const s of ['filled', 'canceled', 'canceled_and_unblock_requested', 'failed']) assert.ok(!isOpenOrder({ status: s }));
    assert.equal(parseOrders({ data: ORDER })[0].code, '23120148686', 'one order (details) reads the same');
  });

  await ok('order body (docs): a BUY volume is toman/tether to spend, a SELL volume is the coin', () => {
    assert.deepEqual(orderBody({ kind: 'market', side: 'buy', base: 'ton', quote: 'IRT', volume: 1200000 }), { side: 'buy', base_symbol: 'TON', quote_symbol: 'IRT', volume: '1200000' });
    assert.deepEqual(orderBody({ kind: 'limit', side: 'sell', base: 'BTC', quote: 'USDT', volume: 0.00012345, price: 65000 }), { side: 'sell', base_symbol: 'BTC', quote_symbol: 'USDT', volume: '0.00012345', price: '65000' });
    assert.deepEqual(orderBody({ kind: 'market', side: 'buy', base: 'GOLDBOX', quote: 'IRT', volume: 5e6, account: 'investment' }), { side: 'buy', base_symbol: 'GOLDBOX', quote_symbol: 'IRT', volume: '5000000', account_type: 'investment' });
    assert.equal(typeof orderBody({ kind: 'limit', side: 'sell', base: 'BTC', quote: 'USDT', volume: 1 }), 'string', 'a limit order needs its price');
    assert.equal(typeof orderBody({ kind: 'market', side: 'buy', base: 'TON', quote: 'IRT', volume: 0 }), 'string');
    assert.equal(typeof orderBody({ kind: 'market', side: 'buy', base: 'USDT', quote: 'USDT', volume: 1 }), 'string');
  });

  await ok('checks: what a buy gets and a sell brings after the 0.38% fee; min/max, balance and far-limit warnings', () => {
    const t = parseTicker(TICKER);
    const info = parseCoinInfo(COIN_INFO)!;
    const bal = [{ symbol: 'XRP', balance: 36, available: 30, blocked: 6 }, { symbol: 'IRT', balance: 5e6, available: 5e6, blocked: 0 }];
    const b = orderChecks({ kind: 'market', side: 'buy', base: 'XRP', quote: 'IRT', volume: 2_626_257.92 }, t, bal, info);
    assert.equal(b.price, 262625.792, 'a buyer pays the buy price');
    assert.ok(Math.abs(b.coinQty! - 10 * 0.9962) < 1e-9);
    assert.deepEqual(b.warnings, []);
    const s = orderChecks({ kind: 'market', side: 'sell', base: 'XRP', quote: 'IRT', volume: 2 }, t, bal, info);
    assert.equal(s.price, 260477.4744, 'a seller gets the sell price');
    assert.ok(Math.abs(s.quoteValue! - 2 * 260477.4744 * 0.9962) < 1e-6);
    assert.equal(s.warnings.length, 1, 'below the 913,000 toman minimum');
    const big = orderChecks({ kind: 'market', side: 'sell', base: 'XRP', quote: 'IRT', volume: 35 }, t, bal, info);
    assert.equal(big.warnings.length, 1, 'more than the 30 free');
    const far = orderChecks({ kind: 'limit', side: 'buy', base: 'XRP', quote: 'IRT', volume: 4e6, price: 300000 }, t, bal, info);
    assert.equal(far.warnings.length, 2, 'above the market by 14%, fills at once');
    assert.equal(orderChecks({ kind: 'market', side: 'buy', base: 'XRP', quote: 'USDT', volume: 10 }, t, bal, info).coinQty, null, 'a toman price is never used for a tether order');
  });

  await ok('balances into assets: board coins as market assets, others at the exchange\'s sell price; a second sync updates', () => {
    let i = 0;
    const id = () => `x${++i}`;
    const bal = [...parseBalances(BALANCES), { symbol: 'IRT', balance: 5e6, available: null, blocked: null }, { symbol: 'ZZZ', balance: 9, available: 9, blocked: 0 }];
    const r = assetsFromBalances([], bal, parseTicker(TICKER), id);
    assert.deepEqual(r.upsert.map((a) => [a.name, a.kind, a.key ?? null, a.qty ?? null, a.valueRial ?? null]), [
      ['آبان‌تتر — USDT', 'market', 'usdt', 188.000994, null],
      ['آبان‌تتر — XRP', 'manual', null, null, Math.round(260477.4744 * 36 * 10)],
    ]);
    assert.deepEqual(r.skipped, ['ZZZ'], 'no price: not valued at zero, named');
    const again = assetsFromBalances(r.upsert.map((a) => ({ ...a, costRial: 1_000_000 })), [{ symbol: 'USDT', balance: 200, available: 200, blocked: 0 }], [], id);
    assert.equal(again.upsert[0].id, r.upsert[0].id, 'the same asset, updated');
    assert.equal(again.upsert[0].qty, 200);
    assert.equal(again.upsert[0].costRial, 1_000_000, 'what the user wrote about it stays');
  });

  await ok('the key: on the device only, sent bare as the docs say, only to api.abantether.com; none on the public ticker', async () => {
    saveKey('  secret-key  ');
    assert.equal(loadKey(), 'secret-key');
    log = [];
    route = () => ({ status: 200, body: BALANCES });
    assert.ok((await abanApi.balances()).ok);
    assert.deepEqual(log.map((x) => [x.url, x.auth]), [['https://api.abantether.com/api/v1/accounting/balances?type=spot', 'secret-key']]);
    log = [];
    await abanApi.ticker();
    assert.equal(log[0].auth, null);
    assert.equal(log[0].url, 'https://api.abantether.com/api/v1/manager/otc/ticker');
    saveKey('');
    assert.equal((await abanApi.orders()).ok, false);
    assert.equal(log.length, 1, 'no key: nothing sent');
    saveKey('secret-key');
  });

  await ok('an order is sent exactly once, whatever comes back (401, 404, 400, 429, 500, lost connection)', async () => {
    for (const status of [201, 401, 404, 400, 429, 500, -1]) {
      log = [];
      route = () => ({ status, body: status === 201 ? { data: ORDER } : { message: 'موجودی کافی نیست' } });
      const r = await abanApi.place('market', { side: 'buy', base_symbol: 'TON', quote_symbol: 'IRT', volume: '1200000' });
      assert.equal(log.length, 1, `status ${status}: one request`);
      assert.equal(log[0].url, 'https://api.abantether.com/api/v1/order_handler/orders/otc/market');
      assert.equal(log[0].auth, 'secret-key');
      assert.equal(r.ok, status === 201);
      if (status === 400) assert.match(r.error!, /موجودی کافی نیست/, 'the exchange\'s own message is shown');
      if (status === -1) assert.match(r.error!, /اپ اندروید/, 'a browser is told why');
    }
    log = [];
    route = () => ({ status: 200, body: { data: { order_id: 'abc' } } });
    await abanApi.cancel('abc');
    assert.deepEqual([log[0].method, log[0].url, log[0].body], ['POST', 'https://api.abantether.com/api/v1/order_handler/orders/otc/abc/cancel', null]);
  });

  console.log(`\n${n} aban checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
