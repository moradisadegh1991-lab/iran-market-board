/**
 * Pins account detection from bank SMS and the bank-balance check (lib/finance/sources.ts).
 * Run: npx tsx scripts/sources-test.ts
 */
import assert from 'node:assert';
import { rowsFromMessages, commitStaged } from '../lib/finance/importers';
import { smsParser } from '../lib/finance/sms';
import { applyReconcile, createAccountForSource, learnFromCommit, linkSource, queueSms, reconcile, reportBalance, sourceLabel, stagedAt, unlinkedSources } from '../lib/finance/sources';
import { emptyData, normalizeData } from '../lib/finance/model';
import { accountBalances } from '../lib/finance/calc';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-02';
const T = (h: number, m = 0, day = 1) => Date.parse(`2026-10-0${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:30`);
// what a phone inbox gives: receive time, sender, body (shapes the parser test already pins)
const inbox = [
  { at: T(9), address: '+98700717', body: 'برداشت: 1,250,000 ریال\nکارت: *4417\nمانده: 12,300,000' },
  { at: T(12), address: '+98700717', body: 'واریز 3,000,000 ریال به حساب شما حساب: 1234567890 مانده: 45,000,000' },
  { at: T(18), address: '+98700717', body: 'برداشت: 700,000 ریال کارت: *4417 مانده: 11,600,000' },
  { at: T(10, 0, 2), address: 'BankMellat', body: 'خرید 200,000 ریال کارت: *9921' },
];

ok('cards and accounts are found in SMS, with the latest stated balance', () => {
  const d = emptyData(TODAY);
  const r = rowsFromMessages(inbox, smsParser, TODAY);
  const { added, newSources } = queueSms(d, r.rows, T(20));
  assert.equal(added, 4);
  assert.equal(newSources, 3, 'card 4417, account 1234567890, card 9921');
  const card = d.smsSources.find((s) => s.key === 'card:4417')!;
  assert.deepEqual([card.count, card.lastBalanceRial, card.lastBalanceAt], [2, 11_600_000, T(18)], 'the 18:00 balance wins over 09:00');
  assert.equal(d.smsSources.find((s) => s.key === 'acc:1234567890')!.lastBalanceRial, 45_000_000);
  assert.equal(d.smsSources.find((s) => s.key === 'card:9921')!.bank, 'BankMellat', 'a named sender beats a number');
  assert.match(sourceLabel(d.smsSources.find((s) => s.key === 'card:9921')!), /^کارت \u2066••9921\u2069 · BankMellat$/);
  assert.equal(unlinkedSources(d).length, 3);
  assert.ok(d.inbox.every((x) => x.accountId === null), 'nothing is assigned until the user links a card');
  // the same messages again: no double counting
  queueSms(d, rowsFromMessages(inbox, smsParser, TODAY).rows, T(21));
  assert.equal(d.smsSources.find((s) => s.key === 'card:4417')!.count, 2);
});

ok('linking a card assigns its queued rows and later SMS, and records the bank balance', () => {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: '2026-01-01' });
  queueSms(d, rowsFromMessages(inbox.slice(0, 1), smsParser, TODAY).rows, T(20));
  linkSource(d, 'card:4417', 'a-mellat');
  assert.equal(d.inbox[0].accountId, 'a-mellat');
  assert.deepEqual(d.accounts[1].reported, { rial: 12_300_000, date: '2026-10-01', time: '09:00', via: 'sms' });
  queueSms(d, rowsFromMessages(inbox.slice(2, 3), smsParser, TODAY).rows, T(20));
  assert.equal(d.inbox[1].accountId, 'a-mellat', 'a later SMS of a linked card arrives with its account');
  assert.equal(d.accounts[1].reported!.rial, 11_600_000);
  // an older statement balance does not overwrite a newer SMS one
  reportBalance(d, 'a-mellat', 99, T(8), 'statement');
  assert.equal(d.accounts[1].reported!.rial, 11_600_000);
});

ok('reconcile: bank balance vs book at the same moment; one tap fixes the opening balance', () => {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' });
  queueSms(d, rowsFromMessages(inbox.slice(0, 3), smsParser, TODAY).rows, T(20));
  linkSource(d, 'card:4417', 'a');
  // book the two card SMS (09:00 and 18:00)
  for (const s of [...d.inbox].filter((x) => x.card === '4417')) assert.equal(commitStaged(d, s.id, { choice: 'expense', accountId: 'a' }), null);
  assert.equal(d.txns[0].time, '09:00', 'the SMS time is kept on the transaction');
  const r = reconcile(d, 'a')!;
  assert.deepEqual([r.reportedRial, r.bookRial, r.diffRial], [11_600_000, -1_950_000, 13_550_000]);
  assert.equal(applyReconcile(d, 'a'), 13_550_000);
  assert.equal(reconcile(d, 'a')!.diffRial, 0);
  assert.equal(accountBalances(d)['a'], 11_600_000, 'the book now matches the bank');
  // a transaction after the stated moment does not count against it
  d.txns.push({ id: 'later', date: '2026-10-01', time: '19:30', kind: 'expense', amountRial: 100_000, accountId: 'a' });
  assert.equal(reconcile(d, 'a')!.diffRial, 0);
  d.txns.push({ id: 'before', date: '2026-10-01', time: '17:00', kind: 'expense', amountRial: 50_000, accountId: 'a' });
  assert.equal(reconcile(d, 'a')!.diffRial, 50_000, 'an earlier one does');
});

ok('new account for a card; booking a row teaches the card its account', () => {
  const d = emptyData(TODAY);
  queueSms(d, rowsFromMessages(inbox, smsParser, TODAY).rows, T(20));
  const id = createAccountForSource(d, 'card:4417', 'کارت ملت', TODAY)!;
  const acc = d.accounts.find((a) => a.id === id)!;
  assert.deepEqual([acc.kind, acc.openingRial, acc.openedOn], ['bank', 0, '2026-10-01']);
  assert.equal(d.inbox.filter((x) => x.accountId === id).length, 2);
  // the 9921 card is booked by hand to the cash account → it learns that link
  const row = d.inbox.find((x) => x.card === '9921')!;
  assert.equal(commitStaged(d, row.id, { choice: 'expense', accountId: 'a-cash' }), null);
  learnFromCommit(d, row, 'a-cash');
  assert.equal(d.smsSources.find((s) => s.key === 'card:9921')!.accountId, 'a-cash');
  // survives the backup round-trip
  const back = normalizeData(JSON.parse(JSON.stringify(d)), TODAY);
  assert.equal(back.smsSources.length, 3);
  assert.equal(back.accounts.find((a) => a.id === id)!.reported!.rial, 11_600_000);
  assert.deepEqual(normalizeData({ ...JSON.parse(JSON.stringify(d)), smsSources: undefined }, TODAY).smsSources, [], 'old backups load');
});

ok('row time: inbox time first, else date + time in Tehran', () => {
  assert.equal(stagedAt({ at: 5, date: '2026-10-01', time: '10:00' }), 5);
  assert.equal(stagedAt({ date: '2026-10-01', time: '9:05' }), Date.parse('2026-10-01T09:05:00+03:30'));
  assert.equal(stagedAt({ date: '2026-10-01', time: null }), Date.parse('2026-10-01T23:59:00+03:30'));
  assert.equal(stagedAt({ date: null }), null);
});

console.log(`\n${n} sources checks passed`);
