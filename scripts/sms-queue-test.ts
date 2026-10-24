/**
 * Pins the bank-SMS page's three promises (rule 99):
 *  • an SMS that only announces a balance («مانده حساب: …») is never a transaction to confirm — it updates
 *    the linked account's balance and is listed on its own (before, it was queued with the balance, or
 *    the account number, as its «amount»);
 *  • «نادیده بگیر» is permanent: reading the phone again, over any time range, never brings it back;
 *    «برگرداندن به صف» does;
 *  • the time filter: ranges in Tehran days and Jalali months; reading a past range from the phone
 *    does not move the «since last read» mark past days it never read.
 * Run: npx tsx scripts/sms-queue-test.ts
 */
import assert from 'node:assert';
import { dismissStaged, KEEP_DISMISSED_ROWS, rowsFromMessages, undismissSms, wasDismissed } from '../lib/finance/importers';
import { emptyData, type FinanceData, type Staged } from '../lib/finance/model';
import { PHONE_READ_KEY, readInbox, type SmsPlugin } from '../lib/finance/phone-sms';
import { smsParser } from '../lib/finance/sms';
import { inRange, rangeBounds, readWindow } from '../lib/finance/sms-filter';
import { balanceSmsAccount, linkSource, moveQueuedBalances, queueSms, queueSmsResult } from '../lib/finance/sources';
import { balances } from '../lib/finance/balance';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-24'; // ۲ آبان ۱۴۰۵
const T = (iso: string, h = 12, m = 0) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:30`);
const BAL = 'بانک ملت\nکارت 603799******4417\nمانده حساب: 12,300,000 ریال';
const BAL_ACC = 'موجودی حساب 0123456 : 45,600,000 ریال';
const W = 'برداشت: 1,250,000 ریال\nکارت: *4417\nمانده: 11,050,000';
const read = (msgs: { body: string; at: number }[]) => rowsFromMessages(msgs.map((m) => ({ ...m, address: '+98700717' })), smsParser, TODAY);

function book(): FinanceData {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' });
  queueSms(d, read([{ body: 'برداشت: 5,000 ریال کارت: *4417', at: T('2026-09-02') }]).rows, T('2026-09-02'));
  linkSource(d, 'card:4417', 'a-mellat');
  d.inbox = [];
  return d;
}

(async () => {
  await ok('a balance announcement is not a row of the queue; a withdrawal with its balance still is', () => {
    const r = read([
      { body: BAL, at: T('2026-10-20') },
      { body: BAL_ACC, at: T('2026-10-21') },
      { body: W, at: T('2026-10-22') },
    ]);
    assert.equal(r.rows.length, 1, 'only the withdrawal');
    assert.equal(r.rows[0].amountRial, 1_250_000);
    assert.equal(r.balances.length, 2);
    assert.deepEqual(
      r.balances.map((b) => [b.balanceRial, b.card, b.accountNo, b.balanceOnly]),
      [
        [12_300_000, '4417', null, true],
        [45_600_000, null, '0123456', true], // the balance, not the account number 123,456
      ],
    );
  });

  await ok('a linked card takes the balance into its account; an unlinked one is listed, not guessed', () => {
    const d = book();
    const r = read([
      { body: BAL, at: T('2026-10-20') },
      { body: BAL_ACC, at: T('2026-10-21') },
    ]);
    const res = queueSmsResult(d, r, T('2026-10-21', 13));
    assert.equal(res.added, 0);
    assert.equal(res.balances, 2);
    assert.equal(d.inbox.length, 0, 'nothing to confirm');
    assert.equal(d.balanceSms!.length, 2);
    assert.equal(balanceSmsAccount(d, d.balanceSms![0]), 'a-mellat');
    assert.equal(balanceSmsAccount(d, d.balanceSms![1]), null, 'account 0123456 was never linked');
    assert.equal(balances(d)['a-mellat'], 12_300_000, 'the bank-stated balance is the account balance (rule 76)');
    // read again: not listed twice
    assert.equal(queueSmsResult(d, r, T('2026-10-22')).balances, 0);
    assert.equal(d.balanceSms!.length, 2);
  });

  await ok('«نادیده بگیر» is permanent: the same SMS read again (any range) is not queued', () => {
    const d = book();
    const r = read([{ body: W, at: T('2026-10-22') }]);
    queueSms(d, r.rows, T('2026-10-22'));
    assert.equal(d.inbox.length, 1);
    dismissStaged(d, [d.inbox[0].id], T('2026-10-22', 13));
    assert.equal(d.inbox.length, 0);
    assert.ok(wasDismissed(d, r.rows[0]));
    // the phone read again — same message, its provider time a few seconds off
    const again = read([{ body: W, at: T('2026-10-22') + 4_000 }]);
    const res = queueSmsResult(d, again, T('2026-10-23'));
    assert.equal(res.added, 0);
    assert.equal(res.dismissed, 1, 'counted as ignored, so the page can say why');
    assert.equal(d.inbox.length, 0);
    // the same text on another day is another transaction
    queueSms(d, read([{ body: W, at: T('2026-10-23') }]).rows, T('2026-10-23'));
    assert.equal(d.inbox.length, 1, 'a later SMS with the same wording is new');
  });

  await ok('«برگرداندن به صف» puts the row back; old ignored entries keep only their key', () => {
    const d = book();
    const r = read([{ body: W, at: T('2026-10-22') }]);
    queueSms(d, r.rows, T('2026-10-22'));
    const id = d.inbox[0].id;
    dismissStaged(d, [id]);
    assert.equal(undismissSms(d, r.rows[0].smsKey!, r.rows[0].at!), true);
    assert.deepEqual(d.inbox.map((x) => x.id), [id]);
    assert.equal(d.smsDismissed!.length, 0);
    // many ignored: the oldest lose their row, never their key
    const rows: Staged[] = Array.from({ length: KEEP_DISMISSED_ROWS + 5 }, (_, i) => read([{ body: `برداشت: ${1000 + i},000 ریال کارت: *4417`, at: T('2026-10-01') + i * 600_000 }]).rows[0]);
    queueSms(d, rows, T('2026-10-23'));
    dismissStaged(d, d.inbox.map((x) => x.id));
    assert.equal(d.smsDismissed!.filter((x) => x.row).length, KEEP_DISMISSED_ROWS);
    assert.ok(rows.every((x) => wasDismissed(d, x)), 'every key still keeps its SMS away');
    queueSms(d, rows, T('2026-10-24'));
    assert.equal(d.inbox.length, 0);
  });

  await ok('rows queued by an earlier version as «transactions» move to the balance list', () => {
    const d = book();
    // what the old code queued: amount = the account number, direction unknown
    d.inbox.push({ id: 'old', source: 'sms', date: '2026-10-20', time: '12:00', at: T('2026-10-20'), amountRial: 123_456, direction: null, why: '', description: '', raw: BAL_ACC, smsKey: 'k-old', importedAt: 1 });
    queueSms(d, read([{ body: W, at: T('2026-10-22') }]).rows, T('2026-10-22'));
    assert.equal(moveQueuedBalances(d, smsParser, T('2026-10-24')), 1);
    assert.equal(d.inbox.length, 1, 'the real withdrawal stays');
    assert.equal(d.balanceSms!.at(-1)!.balanceRial, 45_600_000);
    assert.equal(moveQueuedBalances(d, smsParser, T('2026-10-24')), 0);
  });

  await ok('time ranges: Tehran days, Jalali month, a backwards custom range, undated rows only under «همه»', () => {
    assert.deepEqual(rangeBounds({ kind: 'today' }, TODAY), { from: TODAY, to: TODAY });
    assert.deepEqual(rangeBounds({ kind: 'd7' }, TODAY), { from: '2026-10-18', to: TODAY });
    assert.deepEqual(rangeBounds({ kind: 'month' }, TODAY), { from: '2026-10-23', to: TODAY }, '۱ آبان ۱۴۰۵ = 2026-10-23');
    assert.deepEqual(rangeBounds({ kind: 'custom', from: '2026-10-10', to: '2026-10-01' }, TODAY), { from: '2026-10-01', to: '2026-10-10' });
    const b = rangeBounds({ kind: 'd7' }, TODAY);
    assert.equal(inRange('2026-10-18', b), true);
    assert.equal(inRange('2026-10-17', b), false);
    assert.equal(inRange(null, b), false);
    assert.equal(inRange(null, rangeBounds({ kind: 'all' }, TODAY)), true);
  });

  await ok('phone read windows: «since last read», a past range ends where it ends', () => {
    const now = T(TODAY, 15);
    assert.deepEqual(readWindow({ kind: 'all' }, TODAY, 111, 60, now), { sinceMs: 111, untilMs: null });
    assert.deepEqual(readWindow({ kind: 'd7' }, TODAY, 111, 60, now), { sinceMs: T('2026-10-18', 0), untilMs: null });
    assert.deepEqual(readWindow({ kind: 'custom', from: '2026-10-01', to: '2026-10-05' }, TODAY, null, 60, now), { sinceMs: T('2026-10-01', 0), untilMs: T('2026-10-06', 0) - 1 });
  });

  await ok('reading a past range does not move the «since last read» mark over days it skipped', async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const inbox = [
      { body: W, date: T('2026-10-02') },
      { body: 'واریز 3,000,000 ریال به حساب شما کارت: *4417', date: T('2026-10-20') },
      { body: BAL, date: T('2026-10-23') },
    ];
    const asked: number[] = [];
    const plugin: SmsPlugin = {
      checkPermission: async () => ({ granted: true }),
      requestPermission: async () => ({ granted: true }),
      read: async ({ sinceMs }) => {
        asked.push(sinceMs);
        return { messages: inbox.filter((m) => m.date >= sinceMs) };
      },
    };
    store.set(PHONE_READ_KEY, String(T('2026-10-01')));
    // the last 7 days after three weeks away: the mark stays, so the next automatic read still gets 2 مهر…
    const r1 = await readInbox(plugin, TODAY, null, true, readWindow({ kind: 'd7' }, TODAY, T('2026-10-01'), 60, T(TODAY, 15)));
    assert.equal(r1!.rows.length, 1);
    assert.equal(r1!.balances.length, 1);
    assert.equal(store.get(PHONE_READ_KEY), String(T('2026-10-01')));
    // …a custom range in the past is cut at its last day
    const r2 = await readInbox(plugin, TODAY, null, true, readWindow({ kind: 'custom', from: '2026-10-01', to: '2026-10-10' }, TODAY, null, 60, T(TODAY, 15)));
    assert.equal(r2!.rows.length, 1, 'only 2 مهر… (10 Oct ends the range)');
    assert.equal(store.get(PHONE_READ_KEY), String(T('2026-10-02')), 'read from the mark without a gap: it moves');
    // and the plain read continues from there
    const r3 = await readInbox(plugin, TODAY, null, true);
    assert.equal(asked.at(-1), T('2026-10-02'));
    assert.equal(r3!.rows.length, 2);
    assert.equal(store.get(PHONE_READ_KEY), String(T('2026-10-23')));
  });

  console.log(`\n${n} checks passed\nSMS QUEUE OK`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
