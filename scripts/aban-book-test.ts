/**
 * آبان‌تتر در دفتر (lib/aban/book.ts, rule 104) and the box symbols: a box (AST_USDTBOX) can be ordered; the wallet's toman
 * value is right (IRT = toman); the toman wallet is an account that follows the exchange and is never a «does not agree»
 * question; the coins are assets; money between a bank and the exchange is one transfer — from the bank's SMS when it is
 * already here — and «برگرداندن» undoes exactly that.
 * Run: npx tsx scripts/aban-book-test.ts
 */
import assert from 'node:assert';
import { abanAccount, bookAbanTransfer, linkAbanAccount, syncAban, undoAbanTransfer, abanTransferMatches } from '../lib/aban/book';
import { coinDigits, orderBody, parseBalances, parseCoins, parseTicker, walletValues } from '../lib/aban/parse';
import { balances, monthCheck } from '../lib/finance/balance';
import { netWorth } from '../lib/finance/calc';
import { emptyData, type FinanceData } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-25';
const NOW = Date.parse(`${TODAY}T12:00:00+03:30`);
// the user's own wallet, as the exchange gave it (the screenshot): a box and the toman balance with its decimals
const SPOT = parseBalances({ data: [{ symbol: 'AST_FIXBOX', balance: '150', available: '150', blocked: '0' }, { symbol: 'IRT', balance: '989718.90487673', available: '989718.90487673', blocked: '0' }] });
const TICKER = parseTicker({ data: { markets: { USDTIRT: { symbol: 'USDT', buy_price: '269386', sell_price: '267614', active: true }, AST_USDTBOXIRT: { symbol: 'AST_USDTBOX', buy_price: '278069.8939', sell_price: '276000', active: true } } } });
const COINS = parseCoins({ data: [{ symbol: 'AST_FIXBOX', coin_type: 'FUND', price_buy: '268500', price_sell: '267000' }, { symbol: 'AST_USDTBOX', coin_type: 'FUND', price_buy: '278069.8939', price_sell: '276000' }] });

function book(): FinanceData {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 50_000_000, openedOn: '2026-10-01' });
  return d;
}

ok('a box can be ordered: AST_USDTBOX is a symbol (it was «کدام ارز؟»)', () => {
  const b = orderBody({ kind: 'market', side: 'buy', base: 'AST_USDTBOX', quote: 'IRT', volume: 800000 });
  assert.deepEqual(b, { side: 'buy', base_symbol: 'AST_USDTBOX', quote_symbol: 'IRT', volume: '800000' });
  for (const bad of ['_X', 'X_', 'A', 'AB CD', 'A-B', '']) assert.equal(typeof orderBody({ kind: 'market', side: 'buy', base: bad, quote: 'IRT', volume: 1 }), 'string', bad);
});

ok('the wallet in toman: IRT as is, a box at the exchange sell price, the total; readable digits', () => {
  const w = walletValues(SPOT, TICKER, COINS);
  const irt = w.rows.find((r) => r.symbol === 'IRT')!;
  const box = w.rows.find((r) => r.symbol === 'AST_FIXBOX')!;
  assert.equal(irt.toman, 989718.90487673);
  assert.equal(box.toman, 150 * 267000, 'from the coin list when the ticker has no market for it');
  assert.equal(Math.round(w.totalToman), Math.round(989718.90487673 + 150 * 267000));
  assert.deepEqual(w.unpriced, []);
  assert.deepEqual([coinDigits(989718.9), coinDigits(2.866042), coinDigits(0.000123)], [2, 4, 8]);
  const none = walletValues(parseBalances({ data: [{ symbol: 'ZZZ', balance: '3' }] }), TICKER, COINS);
  assert.deepEqual([none.totalToman, none.unpriced], [0, ['ZZZ']], 'a coin without a price is named, not 0');
});

ok('linked: the toman wallet is an account at the exchange balance; coins are assets; it follows every refresh', () => {
  const d = book();
  const a = linkAbanAccount(d, 989718.90487673, NOW);
  assert.equal(abanAccount(d)!.id, a.id);
  assert.equal(linkAbanAccount(d, 1, NOW).id, a.id, 'linking twice keeps one account');
  assert.equal(balances(d)[a.id], 9_897_189, 'rial = toman × 10');
  const r = syncAban(d, SPOT, TICKER, COINS, NOW + 60_000)!;
  assert.equal(r.balanceChanged, false, 'the same balance: no new statement');
  assert.equal(r.assets, 1);
  assert.equal(d.assets.find((x) => x.name.includes('AST_FIXBOX'))!.valueRial, 150 * 267000 * 10);
  const logBefore = a.reportedLog!.length;
  const r2 = syncAban(d, parseBalances({ data: [{ symbol: 'IRT', balance: '189718.9' }, { symbol: 'AST_FIXBOX', balance: '150' }] }), TICKER, COINS, NOW + 120_000)!;
  assert.equal(r2.balanceChanged, true);
  assert.equal(a.reportedLog!.length, logBefore + 1);
  assert.equal(balances(d)[a.id], 1_897_189);
  // a trade inside the exchange is not a mismatch question
  assert.equal(monthCheck(d, a.id), null);
  // net worth counts the wallet as cash and the box as an asset — once each
  const nw = netWorth(d, [], TODAY);
  assert.ok(nw.netRial >= 1_897_189 + 150 * 267000 * 10 + 50_000_000 - 1);
  // not linked: nothing changes
  const e = book();
  assert.equal(syncAban(e, SPOT, TICKER, COINS, NOW), null);
  assert.equal(e.assets.length, 0);
});

ok('a deposit from the bank: one transfer; the bank SMS already booked as an expense becomes that transfer; undo', () => {
  const d = book();
  const ex = linkAbanAccount(d, 0, NOW);
  // the «نوعش چیست؟» answer booked the bank SMS of the deposit as an expense
  d.txns.push({ id: 't-sms', date: TODAY, kind: 'expense', amountRial: 8_000_000, accountId: 'a-mellat', categoryId: 'c-food', note: 'پرداخت اینترنتی', time: '10:15', smsKey: 'k1' });
  const m = abanTransferMatches(d, 'in', 'a-mellat', 8_000_000, TODAY);
  assert.deepEqual(m.txns.map((t) => t.id), ['t-sms']);
  const r = bookAbanTransfer(d, { flow: 'in', bankId: 'a-mellat', amountRial: 8_000_000, date: TODAY, linkTxnId: 't-sms' }, NOW);
  assert.ok(typeof r !== 'string');
  const t = d.txns.find((x) => x.id === 't-sms')!;
  assert.deepEqual([t.kind, t.accountId, t.toAccountId, t.categoryId, d.txns.length], ['transfer', 'a-mellat', ex.id, null, 1], 'converted, not a second row');
  assert.match(t.note!, /واریز به آبان‌تتر/);
  undoAbanTransfer(d, r as never);
  assert.deepEqual([d.txns[0].kind, d.txns[0].categoryId, d.txns[0].toAccountId], ['expense', 'c-food', undefined]);
});

ok('from the queue, and a plain new transfer; a withdrawal goes the other way; refusals change nothing', () => {
  const d = book();
  const ex = linkAbanAccount(d, 0, NOW);
  d.inbox.push({ id: 's1', source: 'sms', date: TODAY, time: '09:00', amountRial: 5_000_000, direction: 'out', why: 'برداشت', description: 'برداشت کارت', raw: 'x', accountId: 'a-mellat', importedAt: NOW });
  const r = bookAbanTransfer(d, { flow: 'in', bankId: 'a-mellat', amountRial: 5_000_000, date: TODAY, stagedId: 's1' }, NOW);
  assert.ok(typeof r !== 'string');
  assert.equal(d.inbox.length, 0);
  assert.deepEqual([d.txns[0].kind, d.txns[0].accountId, d.txns[0].toAccountId, d.txns[0].time], ['transfer', 'a-mellat', ex.id, '09:00']);
  undoAbanTransfer(d, r as never);
  assert.deepEqual([d.inbox.length, d.txns.length], [1, 0]);
  const w = bookAbanTransfer(d, { flow: 'out', bankId: 'a-mellat', amountRial: 3_000_000, date: TODAY }, NOW);
  assert.ok(typeof w !== 'string');
  assert.deepEqual([d.txns[0].accountId, d.txns[0].toAccountId], [ex.id, 'a-mellat']);
  const before = JSON.stringify(d);
  assert.equal(typeof bookAbanTransfer(d, { flow: 'in', bankId: 'nope', amountRial: 1, date: TODAY }, NOW), 'string');
  assert.equal(typeof bookAbanTransfer(d, { flow: 'in', bankId: 'a-mellat', amountRial: 0, date: TODAY }, NOW), 'string');
  assert.equal(typeof bookAbanTransfer(book(), { flow: 'in', bankId: 'a-mellat', amountRial: 1, date: TODAY }, NOW), 'string', 'not linked');
  assert.equal(JSON.stringify(d), before);
});

console.log(`\n${n} aban-book checks passed`);
