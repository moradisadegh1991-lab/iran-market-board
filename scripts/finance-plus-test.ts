/**
 * Pins the Mehr-1405 additions: last price when the market is shut (lib/finance/prices.ts and the
 * dated unitPrice/netWorth), expected income and the month forecast, editing accounts and loans,
 * my holdings vs the suggested portfolio (compare.ts), and a live session started from holdings.
 * Run: npx tsx scripts/finance-plus-test.ts
 */
import assert from 'node:assert';
import { advisorSummary, cashForecast, monthForecast, monthKey, monthOf, netWorth, shiftMonth, unitPrice, upcoming, accountBalances, loanSchedule } from '../lib/finance/calc';
import { deleteTxn, editAccount, editLoan, settleDue } from '../lib/finance/actions';
import { compareWithSuggested, holdingsForLive } from '../lib/finance/compare';
import { emptyData, normalizeData, type FinanceData } from '../lib/finance/model';
import { normalizeMemo, priceOnDay, priceOnOrBefore, rememberPrices, withLastPrices } from '../lib/finance/prices';
import { createSession, liveTick, seedHoldings, untouchedValueToman, type LiveConfig, type TickContext } from '../lib/engine/live';
import { DEFAULT_PARAMS } from '../lib/engine/simulator';
import { validateConfig } from '../lib/paper';
import { lastClose, type DailyStore } from '../lib/history';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-02'; // 10 مهر 1405, a Friday
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

(async () => {
  // ── last price when the market is shut ──
  await ok('a board row with no price takes the last remembered one, dated; a live row is never overwritten', () => {
    let memo = rememberPrices({}, [{ key: 'coin', price: 120_000_000, unit: 'toman' }, { key: 'usdt', price: 100_000, unit: 'toman' }], '2026-10-01');
    // Friday: the coin row comes back empty, tether still live
    const items = withLastPrices([{ key: 'coin', price: null, unit: 'toman' }, { key: 'usdt', price: 101_000, unit: 'toman' }], memo);
    assert.deepEqual(items.find((x) => x.key === 'coin'), { key: 'coin', price: 120_000_000, unit: 'toman', asOf: '2026-10-01' });
    assert.equal(items.find((x) => x.key === 'usdt')!.price, 101_000);
    assert.equal(items.find((x) => x.key === 'usdt')!.asOf, undefined);
    // a row missing from the board altogether is added back from memory
    assert.equal(withLastPrices([], memo).length, 2);
    // an older dated row (the server's fallback) does not replace a newer memory
    memo = rememberPrices(memo, [{ key: 'coin', price: 99, unit: 'toman', asOf: '2026-09-20' }], TODAY);
    assert.equal(memo.coin.price, 120_000_000);
    assert.deepEqual(normalizeMemo({ coin: memo.coin, bad: { price: -1 }, x: 3 }), { coin: memo.coin });
  });

  await ok('the server fills an empty board row with the last close on or before today', () => {
    const store = { dates: ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'], series: { coin: [1, 2, 3, null], usd: [null, null, null, null] } } as unknown as DailyStore;
    assert.deepEqual(lastClose(store, 'coin', '2026-10-02'), { date: '2026-10-01', value: 3 });
    assert.deepEqual(lastClose(store, 'coin', '2026-09-30'), { date: '2026-09-30', value: 2 }, 'never a later day');
    assert.equal(lastClose(store, 'usd', '2026-10-02'), null);
  });

  await ok('holdings are valued at the last price and say so; BTC takes the older of its two dates', () => {
    const d = emptyData(TODAY);
    d.assets.push({ id: 's1', name: 'سکه امامی', kind: 'market', key: 'coin', qty: 2 }, { id: 's2', name: 'بیت‌کوین', kind: 'market', key: 'btc', qty: 0.01 });
    const items = [
      { key: 'coin', price: 120_000_000, unit: 'toman' as const, asOf: '2026-10-01' },
      { key: 'btc', price: 60_000, unit: 'usd' as const },
      { key: 'usdt', price: 100_000, unit: 'toman' as const, asOf: '2026-09-30' },
    ];
    const nw = netWorth(d, items, TODAY);
    assert.equal(nw.marketRial, 2 * 1_200_000_000 + 0.01 * 60_000 * 100_000 * 10);
    assert.deepEqual(nw.unpriced, []);
    assert.deepEqual(nw.lastPriced, [{ name: 'سکه امامی', asOf: '2026-10-01' }, { name: 'بیت‌کوین', asOf: '2026-09-30' }]);
    assert.equal(unitPrice('btc', items)!.asOf, '2026-09-30');
    assert.equal(unitPrice('btc', [{ key: 'btc', price: 60_000, unit: 'usd' }])?.rial ?? null, null, 'no tether, no rial price (rule 2)');
  });

  await ok('purchase price: the day itself, or the last trading day before it — never a later one', async () => {
    const pts: [number, number][] = [
      [noon('2026-09-29'), 118_000_000],
      [noon('2026-09-30'), 119_000_000],
      [noon('2026-10-01'), 120_000_000], // Thursday; Friday 10-02 has no point
      [noon('2026-10-03'), 125_000_000],
    ];
    assert.deepEqual(priceOnOrBefore(pts, '2026-10-02'), { price: 120_000_000, date: '2026-10-01' });
    assert.deepEqual(priceOnOrBefore(pts, '2026-09-30'), { price: 119_000_000, date: '2026-09-30' });
    assert.equal(priceOnOrBefore(pts, '2026-09-01'), null, 'before the series starts: unknown');
    // a coin quoted in dollars uses tether of that same day
    const fetchPoints = async (k: string): Promise<[number, number][]> =>
      k === 'usdt' ? [[noon('2026-09-30'), 98_000], [noon('2026-10-01'), 100_000], [noon('2026-10-03'), 110_000]] : [[noon('2026-10-01'), 60_000], [noon('2026-10-03'), 70_000]];
    assert.deepEqual(await priceOnDay('btc', 'usd', '2026-10-02', fetchPoints), { rial: 60_000 * 100_000 * 10, date: '2026-10-01' });
    assert.deepEqual(await priceOnDay('coin', 'toman', '2026-10-02', async () => pts), { rial: 1_200_000_000, date: '2026-10-01' });
  });

  // ── expected income ──
  const withSalary = (): FinanceData => {
    const d = emptyData(TODAY);
    d.accounts[0].openingRial = 50_000_000;
    d.incomes.push({ id: 'in1', name: 'حقوق', amountRial: 400_000_000, repeat: 'monthly', day: 25, date: null, categoryId: 'i-salary', fromMonth: monthKey(monthOf(TODAY)), receivedMonths: [], active: true });
    return d;
  };
  await ok('a monthly salary shows in the coming dues and lifts the cash forecast on its day', () => {
    const d = withSalary();
    const dues = upcoming(d, TODAY, 60).filter((x) => x.type === 'income');
    assert.deepEqual(dues.map((x) => [x.date, x.rial, x.label]), [['2026-10-17', 400_000_000, 'حقوق'], ['2026-11-16', 400_000_000, 'حقوق']], '25 مهر and 25 آبان');
    const fc = cashForecast(d, TODAY, 30);
    assert.equal(fc.points.find((p) => p.date === '2026-10-16')!.balanceRial, 50_000_000);
    assert.equal(fc.points.find((p) => p.date === '2026-10-17')!.balanceRial, 450_000_000);
  });

  await ok('«دریافت شد» with the actual amount books the income; deleting it asks again', () => {
    const d = withSalary();
    const due = upcoming(d, TODAY, 30).find((x) => x.type === 'income')!;
    assert.equal(settleDue(d, due, d.accounts[0].id, '2026-10-17', 415_000_000), null);
    assert.deepEqual([d.txns[0].kind, d.txns[0].amountRial, d.txns[0].categoryId], ['income', 415_000_000, 'i-salary']);
    assert.equal(upcoming(d, TODAY, 30).filter((x) => x.type === 'income').length, 0, 'this month received');
    deleteTxn(d, d.txns[0].id);
    assert.equal(upcoming(d, TODAY, 30).filter((x) => x.type === 'income').length, 1, 'reopened');
    // a one-off payment
    d.incomes.push({ id: 'in2', name: 'پاداش', amountRial: 100_000_000, repeat: 'once', day: 1, date: '2026-10-20', categoryId: 'i-other', fromMonth: '', receivedMonths: [], active: true });
    const bonus = upcoming(d, TODAY, 30).find((x) => x.refId === 'in2')!;
    settleDue(d, bonus, d.accounts[0].id, '2026-10-20');
    assert.ok(d.incomes[1].receivedMonths.includes('once'));
    assert.equal(upcoming(d, TODAY, 60).filter((x) => x.refId === 'in2').length, 0);
  });

  await ok('a late salary shows as overdue; months before it was entered are never asked about', () => {
    const d = withSalary();
    d.incomes[0].day = 5; // 5 مهر has passed
    const due = upcoming(d, TODAY, 10).filter((x) => x.type === 'income');
    assert.deepEqual(due.map((x) => [x.date, x.overdue]), [['2026-09-27', true]]);
    d.incomes[0].fromMonth = monthKey(shiftMonth(monthOf(TODAY), 1));
    assert.equal(upcoming(d, TODAY, 10).filter((x) => x.type === 'income').length, 0);
  });

  await ok('month forecast: recorded + expected income − recorded + due + everyday spending at its recent pace', () => {
    const d = withSalary();
    d.loans.push({ id: 'l1', name: 'وام', direction: 'borrowed', principalRial: 120_000_000, annualRatePct: 0, months: 12, firstDueDate: '2026-10-20', paidCount: 0 });
    // 90 days of everyday spending: 3 m toman a month ≈ 1 m rial a day
    for (let i = 1; i <= 90; i++) d.txns.push({ id: `e${i}`, date: new Date(noon(TODAY) - i * 86400000).toISOString().slice(0, 10), kind: 'expense', amountRial: 1_000_000, accountId: 'a-cash', categoryId: 'c-food' });
    const f = monthForecast(d, monthOf(TODAY), TODAY);
    assert.equal(f.incomeBasis, 'entered');
    assert.equal(f.incomeExpectedRial, 400_000_000);
    assert.equal(f.obligationsRial, 10_000_000, 'one installment of 120m/12');
    // 10 Mehr → 30 Mehr: 20 days left at ~1m/day
    assert.ok(Math.abs(f.everydayRial - 20_000_000) < 300_000, String(f.everydayRial));
    assert.equal(Math.round(f.netRial), Math.round(f.incomeActualRial + 400_000_000 - f.expenseActualRial - 10_000_000 - f.everydayRial));
    const next = monthForecast(d, shiftMonth(monthOf(TODAY), 1), TODAY);
    assert.equal(next.incomeActualRial, 0);
    assert.equal(next.incomeExpectedRial, 400_000_000);
    assert.ok(Math.abs(next.everydayRial - 30_000_000) < 400_000, 'a whole month of everyday spending');
    // no expected income entered: the average stands in, and says so
    d.incomes = [];
    d.txns.push({ id: 'i1', date: '2026-08-25', kind: 'income', amountRial: 300_000_000, accountId: 'a-cash', categoryId: 'i-salary' });
    assert.equal(monthForecast(d, shiftMonth(monthOf(TODAY), 1), TODAY).incomeBasis, 'average');
  });

  await ok('the advisor gets expected-income amounts, never their names (rule 7)', () => {
    const d = withSalary();
    d.incomes[0].name = 'حقوق شرکت محرمانه';
    const sum = advisorSummary(d, [], TODAY);
    assert.equal(sum.expectedIncome.monthlyToman, 40_000_000);
    assert.equal(sum.nextMonthForecast.incomeToman, 40_000_000);
    assert.ok(!JSON.stringify(sum).includes('محرمانه'));
  });

  await ok('incomes survive the backup round-trip and an old backup without them', () => {
    const d = withSalary();
    assert.equal(normalizeData(JSON.parse(JSON.stringify(d)), TODAY).incomes[0].amountRial, 400_000_000);
    const old = JSON.parse(JSON.stringify(d));
    delete old.incomes;
    assert.deepEqual(normalizeData(old, TODAY).incomes, []);
  });

  // ── editing ──
  await ok('editing an account: a new current balance moves only the opening balance', () => {
    const d = emptyData(TODAY);
    d.txns.push({ id: 't1', date: TODAY, kind: 'expense', amountRial: 2_000_000, accountId: 'a-cash', categoryId: 'c-food' });
    assert.equal(editAccount(d, 'a-cash', { name: ' کیف ', kind: 'wallet', currentRial: 10_000_000 }), null);
    assert.equal(accountBalances(d)['a-cash'], 10_000_000);
    assert.deepEqual([d.accounts[0].name, d.accounts[0].kind, d.accounts[0].openingRial, d.txns.length], ['کیف', 'wallet', 12_000_000, 1]);
    assert.ok(editAccount(d, 'a-cash', { name: '  ' }));
    assert.ok(editAccount(d, 'nope', {}));
  });

  await ok('editing a loan: new terms re-draw the schedule; booked installments cannot be undone or overtaken', () => {
    const d = emptyData(TODAY);
    d.loans.push({ id: 'l1', name: 'وام', direction: 'borrowed', principalRial: 120_000_000, annualRatePct: 0, months: 12, firstDueDate: '2026-10-20', paidCount: 0 });
    const due = upcoming(d, '2026-10-21', 5).find((x) => x.type === 'loan')!;
    settleDue(d, due, 'a-cash', '2026-10-21');
    const base = { ...d.loans[0] };
    assert.equal(editLoan(d, 'l1', { ...base, months: 24, annualRatePct: 18 }), null);
    assert.equal(loanSchedule(d.loans[0]).length, 24);
    assert.equal(d.loans[0].paidCount, 1);
    assert.match(editLoan(d, 'l1', { ...base, paidCount: 0 })!, /ثبت شده/);
    assert.ok(editLoan(d, 'l1', { ...base, months: 0 }));
    assert.match(editLoan(d, 'l1', { ...base, direction: 'lent' })!, /نوع/);
    assert.equal(d.loans[0].months, 24, 'a refused edit changes nothing');
  });

  // ── compare with the suggested portfolio ──
  await ok('holdings mapped to the suggested classes, with buy/sell amounts that net to zero', () => {
    const d = emptyData(TODAY);
    d.accounts[0].openingRial = 200_000_000;
    d.assets.push(
      { id: 's1', name: 'طلا', kind: 'market', key: 'g18', qty: 10 },
      { id: 's2', name: 'دلار', kind: 'market', key: 'usd', qty: 100 },
      { id: 's3', name: 'خانه', kind: 'manual', valueRial: 9e10 },
      { id: 's4', name: 'نقره', kind: 'market', key: 'silver', qty: 5 },
    );
    const items = [
      { key: 'g18', price: 8_000_000, unit: 'toman' as const },
      { key: 'usd', price: 100_000, unit: 'toman' as const },
    ];
    const lines = [
      { cls: 'cash' as const, label: 'درآمد ثابت', weight: 0.3 },
      { cls: 'usd' as const, label: 'دلار', weight: 0.2 },
      { cls: 'gold' as const, label: 'طلا', weight: 0.3 },
      { cls: 'equity' as const, label: 'سهام', weight: 0.1 },
      { cls: 'btc' as const, label: 'بیت‌کوین', weight: 0.1 },
      { cls: 'spec' as const, label: 'آلت', weight: 0 },
    ];
    const c = compareWithSuggested(d, items, lines, { includeAccounts: true });
    // cash 200m, usd 100m, gold 800m rial
    assert.equal(c.totalRial, 1_100_000_000);
    const gold = c.rows.find((r) => r.cls === 'gold')!;
    assert.equal(Math.round(gold.minePct), 73);
    assert.equal(Math.round(gold.moveRial), Math.round(0.3 * 1_100_000_000 - 800_000_000));
    assert.ok(Math.abs(c.rows.reduce((s, r) => s + r.moveRial, 0)) < 1, 'rebalancing keeps the same total');
    assert.deepEqual(c.excluded, [{ name: 'خانه', why: 'manual' }, { name: 'نقره', why: 'unpriced' }]);
    assert.equal(compareWithSuggested(d, items, lines, { includeAccounts: false }).totalRial, 900_000_000);
  });

  await ok('holdings the live engine can trade, summed per instrument; the rest named', () => {
    const d = emptyData(TODAY);
    d.assets.push(
      { id: '1', name: 'سکه', kind: 'market', key: 'coin', qty: 1 },
      { id: '2', name: 'سکه دوم', kind: 'market', key: 'coin', qty: 2 },
      { id: '3', name: 'نیم‌سکه', kind: 'market', key: 'nim', qty: 1 },
      { id: '4', name: 'ماشین', kind: 'manual', valueRial: 1 },
    );
    assert.deepEqual(holdingsForLive(d), { holdings: [{ asset: 'coin', qty: 3 }], unsupported: ['نیم‌سکه', 'ماشین'] });
  });

  // ── live session from holdings ──
  await ok('a live session started from holdings: positions at the live quote, capital = cash + holdings, no instant stop', () => {
    const cfg = validateConfig({ capitalToman: 0, profile: 'balanced', assets: ['usd'], days: 30, startHoldings: [{ asset: 'coin', qty: 2 }, { asset: 'btc', qty: 0.01 }, { asset: 'bogus', qty: 1 }] });
    assert.deepEqual(cfg.startHoldings, [{ asset: 'coin', qty: 2 }, { asset: 'btc', qty: 0.01 }]);
    assert.deepEqual([...cfg.assets].sort(), ['btc', 'coin', 'usd'], 'held instruments become tradable');
    assert.throws(() => validateConfig({ capitalToman: 0, profile: 'balanced', assets: ['usd'], days: 30 }), 'cash-only still needs capital');
    const now = Date.parse('2026-09-21T09:00:00Z');
    const days = (start: number) => {
      const dates: string[] = [];
      const prices: number[] = [];
      for (let i = 120; i > 0; i--) {
        dates.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
        prices.push(start * (1 + 0.0005 * (120 - i)) * (1 + 0.004 * Math.sin(i)));
      }
      return { dates, prices };
    };
    const daily = { usd: days(1_000_000), coin: days(1_200_000_000), btc: days(6e11) };
    const quotes = { usd: daily.usd.prices.at(-1)!, coin: daily.coin.prices.at(-1)!, btc: daily.btc.prices.at(-1)! };
    const s = createSession('h1', cfg as LiveConfig, DEFAULT_PARAMS, now);
    const seed = seedHoldings(s, { now, quotes, daily });
    assert.deepEqual(seed.seeded, ['coin', 'btc']);
    assert.equal(s.config.capitalToman, Math.round((2 * quotes.coin + 0.01 * quotes.btc) / 10));
    assert.equal(s.positions.coin!.qty, 2);
    assert.ok(s.positions.coin!.stopDist >= 0.05, 'a real stop distance, at least the profile minimum');
    const ctx: TickContext = { now, quotes, usdRial: quotes.usd, daily, news: [] };
    liveTick(s, ctx);
    assert.ok(!s.trades.some((t) => t.kind === 'stop'), 'no stop fires at the price it was seeded at');
    // the holdings break the balanced profile's crypto cap (BTC is ~71% of them): the first review
    // trims it toward 20% — the engine trades the user's holdings by the same rules as its own
    const btcSell = s.trades.find((t) => t.asset === 'btc' && t.side === 'sell');
    assert.ok(btcSell && btcSell.kind === 'trim', 'over-cap BTC is trimmed');
    const btcW = (s.positions.btc!.qty * quotes.btc) / (s.equity.at(-1)!.equity * 10);
    assert.ok(btcW > 0.15 && btcW < 0.25, `BTC weight after the trim ${btcW}`);
    // untouched benchmark: the starting holdings at today's quotes (nothing earned yet) = starting capital
    const cap = s.config.capitalToman;
    assert.ok(Math.abs(untouchedValueToman(s, now)! / cap - 1) < 1e-6);
    // the trades paid spreads, so right after them the session is slightly behind doing nothing
    assert.ok(s.equity.at(-1)!.equity < cap && s.equity.at(-1)!.equity > cap * 0.99);
    // holdings up 10%: untouched follows them
    s.lastQuotes.coin = { price: quotes.coin * 1.1, at: now + 1 };
    s.lastQuotes.btc = { price: quotes.btc * 1.1, at: now + 1 };
    assert.ok(Math.abs(untouchedValueToman(s, now)! / cap - 1.1) < 1e-6);
    // a cash-only session has no such benchmark
    assert.equal(untouchedValueToman(createSession('c', { ...(cfg as LiveConfig), startHoldings: undefined }, DEFAULT_PARAMS, now), now), null);
  });

  console.log(`\n${n} finance-plus checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
