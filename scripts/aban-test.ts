/**
 * آبان‌تتر (lib/aban, rule 101): reading the exchange's answers in the shapes they plausibly take, the order body and
 * its warnings, balances into the book's assets, and — the part that matters for real money — that a request is sent
 * again ONLY when the first one was rejected before doing anything (404 no such path, 401/403 refused key), never
 * after any other answer. The key never goes anywhere but api.abantether.com. A fake fetch plays the exchange.
 * Run: npx tsx scripts/aban-test.ts
 */
import assert from 'node:assert';
import { abanApi, call, loadKey, saveKey } from '../lib/aban/client';
import { assetsFromBalances, num, orderBody, orderChecks, parseBalances, parseOrders, parseTicker, isOpenOrder } from '../lib/aban/parse';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};

// a browser-ish environment
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
  await ok('numbers: strings with separators, Persian digits; junk is not a number', () => {
    assert.equal(num('1,234,500'), 1234500);
    assert.equal(num('۱۲۳٫۵'), 123.5);
    assert.equal(num(0.5), 0.5);
    assert.equal(num('abc'), null);
    assert.equal(num(null), null);
  });

  await ok('ticker: rows, or an object keyed by symbol, wrapped or not', () => {
    const a = parseTicker({ data: [{ symbol: 'btc', buy_price: '6,100,000,000', sell_price: '6,150,000,000' }, { coin: 'USDT', buy: 99_500, sell: 100_100 }] });
    assert.deepEqual(a, [
      { symbol: 'BTC', buy: 6_100_000_000, sell: 6_150_000_000, quote: null },
      { symbol: 'USDT', buy: 99_500, sell: 100_100, quote: null },
    ]);
    const b = parseTicker({ result: { TON: { irt: { buy: '310000', sell: '315000' } }, ETH: { price: 230_000_000 } } });
    assert.deepEqual(b, [
      { symbol: 'ETH', buy: 230_000_000, sell: 230_000_000, quote: null },
      { symbol: 'TON', buy: 310_000, sell: 315_000, quote: 'IRT' },
    ]);
    assert.deepEqual(parseTicker('<html>'), []);
  });

  await ok('balances: the documented rows (symbol, balance, available, blocked); zero balances dropped', () => {
    const b = parseBalances([{ symbol: 'USDT', balance: '120.5', available: '100.5', blocked: '20', debit: '0' }, { symbol: 'BTC', balance: '0', available: '0' }, { symbol: 'IRT', balance: 5_000_000 }]);
    assert.deepEqual(b, [
      { symbol: 'IRT', balance: 5_000_000, available: null, blocked: null },
      { symbol: 'USDT', balance: 120.5, available: 100.5, blocked: 20 },
    ]);
    assert.deepEqual(parseBalances({ data: { ETH: { available: 1, blocked: 0.5 } } }), [{ symbol: 'ETH', balance: 1.5, available: 1, blocked: 0.5 }]);
  });

  await ok('orders: fields under their likely names; open ones can be cancelled', () => {
    const o = parseOrders({ data: { results: [{ id: 17, side: 'sell', base_symbol: 'ton', quote_symbol: 'irt', volume: '2', price: '315000', status: 'pending', created_at: '2026-10-24T10:00:00' }] } });
    assert.deepEqual(o[0], { id: '17', side: 'sell', base: 'TON', quote: 'IRT', volume: 2, price: 315_000, status: 'pending', type: null, at: '2026-10-24T10:00:00' });
    assert.ok(isOpenOrder(o[0]));
    assert.ok(!isOpenOrder({ ...o[0], status: 'done' }));
  });

  await ok('order body: the documented fields; missing pieces refused', () => {
    assert.deepEqual(orderBody({ kind: 'market', side: 'buy', base: 'ton', quote: 'IRT', volume: 2.5 }), { side: 'buy', base_symbol: 'TON', quote_symbol: 'IRT', volume: '2.5' });
    assert.deepEqual(orderBody({ kind: 'limit', side: 'sell', base: 'BTC', quote: 'USDT', volume: 0.00012345, price: 65000 }), { side: 'sell', base_symbol: 'BTC', quote_symbol: 'USDT', volume: '0.00012345', price: '65000' });
    assert.equal(typeof orderBody({ kind: 'limit', side: 'sell', base: 'BTC', quote: 'USDT', volume: 1 }), 'string', 'a limit order needs its price');
    assert.equal(typeof orderBody({ kind: 'market', side: 'buy', base: 'TON', quote: 'IRT', volume: 0 }), 'string');
    assert.equal(typeof orderBody({ kind: 'market', side: 'buy', base: 'USDT', quote: 'USDT', volume: 1 }), 'string');
  });

  await ok('warnings, not blocks: more than the free balance; a limit price far from the market', () => {
    const t = [{ symbol: 'TON', buy: 300_000, sell: 310_000, quote: 'IRT' as const }];
    const bal = [{ symbol: 'TON', balance: 3, available: 2, blocked: 1 }, { symbol: 'IRT', balance: 500_000, available: 500_000, blocked: 0 }];
    const s = orderChecks({ kind: 'market', side: 'sell', base: 'TON', quote: 'IRT', volume: 2.5 }, t, bal);
    assert.equal(s.marketPrice, 300_000, 'a seller gets the exchange\'s buy price');
    assert.equal(s.value, 750_000);
    assert.equal(s.warnings.length, 1);
    const b = orderChecks({ kind: 'limit', side: 'buy', base: 'TON', quote: 'IRT', volume: 2, price: 400_000 }, t, bal);
    assert.equal(b.value, 800_000);
    assert.equal(b.warnings.length, 3, 'over the toman balance, 29% above, fills at once');
    assert.deepEqual(orderChecks({ kind: 'market', side: 'buy', base: 'TON', quote: 'USDT', volume: 1 }, t, bal).value, null, 'a toman price is never shown as a tether value');
  });

  await ok('balances into assets: board coins as market assets, others at the exchange price; a second sync updates', () => {
    let i = 0;
    const id = () => `x${++i}`;
    const bal = [{ symbol: 'USDT', balance: 120.5, available: 120.5, blocked: 0 }, { symbol: 'TON', balance: 2, available: 2, blocked: 0 }, { symbol: 'IRT', balance: 5_000_000, available: null, blocked: null }, { symbol: 'XYZ', balance: 9, available: 9, blocked: 0 }];
    const t = [{ symbol: 'TON', buy: 300_000, sell: 310_000, quote: 'IRT' as const }];
    const r = assetsFromBalances([], bal, t, id);
    assert.deepEqual(r.upsert.map((a) => [a.name, a.kind, a.key ?? null, a.qty ?? null, a.valueRial ?? null]), [
      ['آبان‌تتر — USDT', 'market', 'usdt', 120.5, null],
      ['آبان‌تتر — TON', 'manual', null, null, 6_000_000],
    ]);
    assert.deepEqual(r.skipped, ['XYZ'], 'no price: not valued at zero, named');
    const again = assetsFromBalances(r.upsert.map((a) => ({ ...a, costRial: 1_000_000 })), [{ ...bal[0], balance: 200 }], t, id);
    assert.equal(again.upsert[0].id, r.upsert[0].id, 'the same asset, updated');
    assert.equal(again.upsert[0].qty, 200);
    assert.equal(again.upsert[0].costRial, 1_000_000, 'what the user wrote about it stays');
  });

  await ok('the key: stored on the device only, sent only to api.abantether.com, as «Token …» first', async () => {
    saveKey('  secret-key  ');
    assert.equal(loadKey(), 'secret-key');
    log = [];
    route = () => ({ status: 200, body: [{ symbol: 'USDT', balance: '1' }] });
    const r = await abanApi.balances();
    assert.ok(r.ok);
    assert.deepEqual(log.map((x) => [x.url, x.auth]), [['https://api.abantether.com/api/v1/accounting/balances?type=spot', 'Token secret-key']]);
    log = [];
    await abanApi.ticker();
    assert.equal(log[0].auth, null, 'a public price list goes without the key');
    saveKey('');
    assert.equal(loadKey(), '');
    const none = await abanApi.orders();
    assert.equal(none.ok, false);
    assert.equal(log.length, 1, 'no key: nothing sent');
    saveKey('secret-key');
  });

  await ok('retries only after a rejection that did nothing: 404 → the SDK path; 401 → the bare key, remembered', async () => {
    log = [];
    route = (r) => (r.url.includes('/api/v1/') ? { status: 404, body: { detail: 'Not found.' } } : r.auth === 'secret-key' ? { status: 200, body: { data: { id: 9 } } } : { status: 401, body: { detail: 'Invalid token' } });
    const r = await abanApi.place('market', { side: 'buy', base_symbol: 'TON', quote_symbol: 'IRT', volume: '1' });
    assert.ok(r.ok);
    assert.deepEqual(log.map((x) => [x.url.replace('https://api.abantether.com', ''), x.auth]), [
      ['/api/v1/order_handler/orders/otc/market', 'Token secret-key'],
      ['/order_handler/orders/otc/market', 'Token secret-key'],
      ['/order_handler/orders/otc/market', 'secret-key'],
    ]);
    assert.ok(log.every((x) => x.url.startsWith('https://api.abantether.com/')));
    // the bare form is now tried first
    log = [];
    route = () => ({ status: 200, body: [] });
    await abanApi.orders();
    assert.equal(log[0].auth, 'secret-key');
  });

  await ok('an order is never sent twice: 400, 422, 429, 500 and a lost connection each stop at the first request', async () => {
    for (const status of [400, 422, 429, 500, -1]) {
      log = [];
      route = () => ({ status, body: { message: 'موجودی کافی نیست' } });
      const r = await call(['/api/v1/order_handler/orders/otc/market', '/order_handler/orders/otc/market'], 'POST', { auth: true, body: { side: 'buy' } });
      assert.equal(r.ok, false);
      assert.equal(log.length, 1, `status ${status}: one request`);
      assert.ok(r.error && r.error.length > 5);
      if (status === 400) assert.match(r.error!, /موجودی کافی نیست/, 'the exchange\'s own message is shown');
      if (status === -1) assert.match(r.error!, /اپ اندروید/, 'a browser is told why');
    }
  });

  console.log(`\n${n} aban checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
