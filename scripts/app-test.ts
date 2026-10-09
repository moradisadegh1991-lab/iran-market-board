/**
 * Pins what moved from the earlier Android app into the one app: price alerts / big-move notices
 * (lib/alerts.ts) and carrying the old app's data into the book (lib/finance/migrate.ts).
 * Run: npx tsx scripts/app-test.ts
 */
import assert from 'node:assert';
import { AWAY_MS, checkBoard, DEFAULT_PREFS, normalizeAlerts, normalizePrefs, sinceLastSeen, type BoardItem } from '../lib/alerts';
import { classicCount, CLASSIC_KEYS, migrateClassic, parseClassic } from '../lib/finance/migrate';
import { choicesFor, commitStaged, defaultChoice, suggestCategory } from '../lib/finance/importers';
import { emptyData, normalizeData } from '../lib/finance/model';
import { accountBalances } from '../lib/finance/calc';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const board = (o: Partial<Record<string, [number, number]>>): BoardItem[] =>
  Object.entries(o).map(([key, v]) => ({ key, label: key === 'usd' ? 'دلار' : key === 'coin' ? 'سکه' : key, price: v![0], changePct: v![1], unit: 'toman' }));
const NOW = Date.UTC(2026, 9, 1, 9, 0);

ok('price alert fires once when crossed, then stays disarmed', () => {
  const alerts = normalizeAlerts([{ asset: 'usd', dir: 'above', value: 100_000, fired: 0 }, { asset: 'coin', dir: 'below', value: 50_000_000, fired: 0 }]);
  const p = { ...DEFAULT_PREFS, move: false };
  const r1 = checkBoard(board({ usd: [99_000, 0.2], coin: [60_000_000, 0] }), p, alerts, {}, '2026-10-01', NOW);
  assert.equal(r1.notes.length, 0);
  const r2 = checkBoard(board({ usd: [101_000, 1], coin: [60_000_000, 0] }), p, r1.alerts, {}, '2026-10-01', NOW);
  assert.equal(r2.notes.length, 1);
  assert.match(r2.notes[0].title, /دلار/);
  assert.equal(r2.notes[0].cat, 'alert');
  assert.equal(r2.alerts[0].fired, NOW);
  const r3 = checkBoard(board({ usd: [105_000, 1], coin: [40_000_000, -3] }), p, r2.alerts, {}, '2026-10-01', NOW + 1);
  assert.deepEqual(r3.notes.map((x) => x.cat), ['alert'], 'usd stays quiet, coin fires');
  assert.match(r3.notes[0].body, /پایین‌تر از/);
});

ok('big moves: silent first run, then once per asset per day, summarised past three', () => {
  const p = { ...DEFAULT_PREFS, alert: false, movePct: 2 };
  const b = board({ usd: [1, 3], coin: [1, -4], a: [1, 5], b: [1, 6], c: [1, 7] });
  const first = checkBoard(b, p, [], null, '2026-10-01', NOW);
  assert.equal(first.notes.length, 0, 'installing the app must not fire one notice per asset');
  assert.equal(Object.keys(first.seen!).length, 5);
  const again = checkBoard(b, p, [], first.seen, '2026-10-01', NOW);
  assert.equal(again.notes.length, 0, 'already seen today');
  const tomorrow = checkBoard(b, p, [], first.seen, '2026-10-02', NOW);
  assert.equal(tomorrow.notes.length, 4, 'three notices and one summary');
  assert.match(tomorrow.notes[3].body, /۵ دارایی/);
  assert.ok(Object.keys(tomorrow.seen!).every((k) => k.startsWith('2026-10-02:')), "yesterday's marks are dropped");
  const off = checkBoard(b, { ...p, on: false }, [], first.seen, '2026-10-03', NOW);
  assert.equal(off.notes.length, 0);
});

ok('preferences and alerts from the old app are read as they were stored', () => {
  assert.deepEqual(normalizePrefs({ on: true, sms: false, movePct: 5 }), { ...DEFAULT_PREFS, sms: false, movePct: 5 });
  assert.deepEqual(normalizePrefs('garbage'), DEFAULT_PREFS);
  assert.equal(normalizeAlerts([{ asset: 'usd', value: -1 }, { asset: 'usd', value: 10 }, null]).length, 1);
});

ok('on opening after being away: the main prices that moved, biggest first, three at most', () => {
  const items = board({ usd: [105_000, 0], coin: [98_000_000, 0], g18: [10_050_000, 0], btc: [70_000, 0], eth: [2_000, 0] });
  const last = { at: NOW - 3 * 3_600_000, prices: { usd: 100_000, coin: 100_000_000, g18: 10_000_000, btc: 60_000, eth: 2_000 } };
  const r = sinceLastSeen(items, last, DEFAULT_PREFS, NOW);
  assert.match(r.note!.title, /۳ ساعت پیش/);
  assert.equal(r.note!.cat, 'move');
  assert.deepEqual(r.note!.body.split(' · ').map((x) => x.split(' ')[0]), ['btc', 'دلار', 'سکه'], 'g18 +0.5% and eth 0% are below half the 2% threshold');
  assert.equal(r.seen.prices.usd, 105_000);
  // while the app stays open boards arrive every minute: no notice
  assert.equal(sinceLastSeen(items, { ...last, at: NOW - AWAY_MS + 60_000 }, DEFAULT_PREFS, NOW).note, null);
  // first ever run, or moves off: nothing, but the prices are stored
  assert.equal(sinceLastSeen(items, null, DEFAULT_PREFS, NOW).note, null);
  assert.equal(sinceLastSeen(items, last, { ...DEFAULT_PREFS, move: false }, NOW).note, null);
  assert.equal(sinceLastSeen(items, { at: NOW - 3 * 86_400_000, prices: last.prices }, DEFAULT_PREFS, NOW).note!.title.includes('۳ روز پیش'), true);
});

// what the earlier app actually stored (shapes from android-app/www/index.html before Mehr 1405)
const store: Record<string, unknown> = {
  [CLASSIC_KEYS.cats]: [{ id: 'c1', name: 'خوراک', emoji: '🍽' }, { id: 'c3', name: 'قبوض', emoji: '🧾' }],
  [CLASSIC_KEYS.inCats]: [{ id: 'i1', name: 'حقوق', emoji: '💼' }],
  [CLASSIC_KEYS.tx]: [
    { id: 'x1', at: Date.UTC(2026, 8, 20, 6, 0), amount: 1_250_000, out: true, card: '4417', cat: 'c1', raw: 'برداشت: 1,250,000 ریال', src: 'sms' },
    { id: 'x2', at: Date.UTC(2026, 8, 21, 6, 0), amount: 900_000_000, out: false, cat: 'i1', src: 'sms' },
    { id: 'x3', at: Date.UTC(2026, 8, 22, 6, 0), amount: 2_400_000, out: false, typeUnknown: true, src: 'sms' },
    { id: 'x4', at: Date.UTC(2026, 8, 23, 6, 0), amount: 50_000_000, out: true, transfer: true, src: 'sms' },
    { id: 'x5', at: Date.UTC(2026, 8, 23, 6, 1), amount: 5_000, out: true, fee: true, src: 'sms' },
    { id: 'bad', at: 'x', amount: -1 },
  ],
  [CLASSIC_KEYS.pending]: [{ id: 'p1', at: Date.UTC(2026, 8, 24, 6, 0), body: 'تراکنش کارت شما 3,000,000', amount: 3_000_000, out: true }],
  [CLASSIC_KEYS.holdings]: [
    { instrument: 'g18', qty: 10, paid: 60_000_000, boughtOn: '2026-03-01', at: 1 },
    { instrument: 'btc', qty: 0.01, paid: 0, boughtOn: '', at: 2 },
    { instrument: 'weird', qty: 1, at: 3 },
  ],
};
const get = (k: string) => (k in store ? JSON.stringify(store[k]) : null);

ok('old data is read and shape-checked', () => {
  const c = parseClassic(get);
  assert.equal(c.tx.length, 5, 'the malformed row is dropped');
  assert.equal(c.pending.length, 1);
  assert.equal(c.holdings.length, 3);
  assert.equal(classicCount(c), 9);
  assert.equal(classicCount(parseClassic(() => 'not json')), 0);
});

ok('migration: direction and category kept, unknown stays unknown, transfers suggested, idempotent', () => {
  const d = emptyData('2026-10-01');
  d.accounts.push({ id: 'a-bank', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: '2026-01-01' });
  const c = parseClassic(get);
  const r = migrateClassic(d, c, 'a-bank', NOW);
  assert.deepEqual(r, { queued: 6, assets: 2 });
  const by = (id: string) => d.inbox.find((x) => x.id === id)!;
  assert.equal(by('classic-x1').direction, 'out');
  assert.equal(by('classic-x1').date, '2026-09-20');
  assert.equal(suggestCategory(d, by('classic-x1')), 'c-food');
  assert.equal(suggestCategory(d, by('classic-x2')), 'i-salary');
  assert.equal(by('classic-x3').direction, null, 'rule 3: still asked');
  assert.equal(defaultChoice(by('classic-x3')), undefined);
  assert.equal(defaultChoice(by('classic-x4')), 'transfer-out');
  assert.equal(suggestCategory(d, by('classic-x5')), 'c-other');
  assert.equal(by('classic-p-p1').uncertainAmount, true);
  // holdings: cost carried in rial, unknown instruments skipped
  const gold = d.assets.find((a) => a.key === 'g18')!;
  assert.deepEqual([gold.qty, gold.costRial, gold.boughtOn], [10, 600_000_000, '2026-03-01']);
  assert.equal(d.assets.find((a) => a.key === 'btc')!.costRial, null);
  // booking one, then running the migration again adds nothing
  assert.equal(commitStaged(d, 'classic-x1', { choice: 'expense', accountId: 'a-bank', categoryId: 'c-food' }), null);
  assert.equal(d.txns[0].src, 'classic');
  assert.deepEqual(migrateClassic(d, c, 'a-bank', NOW + 1), { queued: 0, assets: 0 });
  assert.equal(accountBalances(d)['a-bank'], -1_250_000);
  assert.deepEqual(choicesFor(by('classic-x2')), ['income', 'transfer-in', 'lend-in']);
  // survives the backup round-trip
  const back = normalizeData(JSON.parse(JSON.stringify(d)), '2026-10-01');
  assert.equal(back.assets.find((a) => a.key === 'g18')!.costRial, 600_000_000);
  assert.equal(back.inbox.find((x) => x.id === 'classic-x4')!.transfer, true);
});

console.log(`\n${n} app checks passed`);
