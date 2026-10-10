/**
 * یادآوری سررسید (rule 90): the lead set in settings, loans with people that have a repayment date, each due reminded
 * exactly once — scheduled on the phone or shown on opening — and scheduled reminders cancelled when paid, deleted or
 * the lead changes. Run: npx tsx scripts/reminders-test.ts
 */
import assert from 'node:assert';
import { setupBusiness } from '../lib/biz/ops';
import { deleteTxn, settleDue } from '../lib/finance/actions';
import { monthForecast, monthOf, upcoming } from '../lib/finance/calc';
import { bookLend, positions, setPersonDue } from '../lib/finance/lending';
import { DEFAULT_SETTINGS, emptyData, normalizeData } from '../lib/finance/model';
import { emptyReminderState, REMINDER_ID_BASE, reminderPlan, reminderStep, reminderText, tehranMorning } from '../lib/finance/reminders';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-10';
const at = (iso: string, hhmm = '10:00') => Date.parse(`${iso}T${hhmm}:00+03:30`);
function book() {
  const d = emptyData(T);
  d.accounts.push({ id: 'mellat', name: 'کارت ملت', kind: 'bank', openingRial: 500_000_000, openedOn: '2026-10-01' });
  // an installment loan, first installment on 2026-10-15
  d.loans.push({ id: 'car', name: 'وام خودرو', direction: 'borrowed', principalRial: 120_000_000, annualRatePct: 0, months: 12, firstDueDate: '2026-10-15', paidCount: 0 } as never);
  d.bills.push({ id: 'net', name: 'اینترنت', amountRial: 3_000_000, dueDay: 25, categoryId: 'c-bills', active: true, paidMonths: [] } as never);
  return d;
}

ok('the lead: default 3 days, kept between 0 and 30 from a backup', () => {
  assert.equal(DEFAULT_SETTINGS.reminderDays, 3);
  const raw = { ...emptyData(T), settings: { inflationPct: 40, safeYieldPct: 30, emergencyMonths: 6 } };
  assert.equal(normalizeData(raw, T).settings.reminderDays, 3, 'an old backup without it gets the default');
  assert.equal(normalizeData({ ...raw, settings: { ...raw.settings, reminderDays: 90 } }, T).settings.reminderDays, 30);
  assert.equal(normalizeData({ ...raw, settings: { ...raw.settings, reminderDays: -2 } }, T).settings.reminderDays, 0);
});

ok('a loan with a person and a repayment date is a due; settled in part or whole from the due list; cleared when closed, back on delete', () => {
  const d = book();
  bookLend(d, { kind: 'lend', person: 'علی', accountId: 'mellat', amountRial: 50_000_000, date: '2026-10-01', dueOn: '2026-10-20' });
  bookLend(d, { kind: 'borrow', person: 'رضا', accountId: 'mellat', amountRial: 10_000_000, date: '2026-10-02', dueOn: '2026-10-12' });
  bookLend(d, { kind: 'lend', person: 'سارا', accountId: 'mellat', amountRial: 7_000_000, date: '2026-10-02' }); // no date: no due
  const lends = upcoming(d, T, 30).filter((x) => x.type === 'lend');
  assert.deepEqual(
    lends.map((x) => [x.label, x.date, x.rial]),
    [
      ['پس دادن قرض به رضا', '2026-10-12', -10_000_000],
      ['پس گرفتن قرض از علی', '2026-10-20', 50_000_000],
    ],
  );
  // a loan is a transfer: not in the month's forecast of income and spending (rule 84)
  const before = monthForecast(d, monthOf(T), T);
  const ali = d.accounts.find((a) => a.name === 'علی')!;
  setPersonDue(d, ali.id, null);
  const reza = d.accounts.find((a) => a.name === 'رضا')!;
  setPersonDue(d, reza.id, null);
  const after = monthForecast(d, monthOf(T), T);
  assert.deepEqual([before.obligationsRial, before.incomeExpectedRial], [after.obligationsRial, after.incomeExpectedRial], 'loan dates do not change the month forecast');
  setPersonDue(d, ali.id, '2026-10-20');
  // part repaid: the due stays with what is left
  const due = upcoming(d, T, 30).find((x) => x.type === 'lend')!;
  assert.equal(settleDue(d, due, 'mellat', T, 20_000_000), null);
  assert.equal(upcoming(d, T, 30).find((x) => x.type === 'lend')!.rial, 30_000_000);
  assert.equal(ali.dueOn, '2026-10-20');
  // the rest: closed, the date goes with it — onto the transaction that closed it
  assert.equal(settleDue(d, upcoming(d, T, 30).find((x) => x.type === 'lend')!, 'mellat', T), null);
  assert.equal(positions(d).find((p) => p.account.id === ali.id)!.balanceRial, 0);
  assert.equal(ali.dueOn, null);
  assert.equal(upcoming(d, T, 30).filter((x) => x.type === 'lend').length, 0);
  const closing = d.txns[d.txns.length - 1];
  assert.equal(closing.link?.due, '2026-10-20');
  deleteTxn(d, closing.id);
  assert.equal(ali.dueOn, '2026-10-20', 'deleting the repayment that closed it reopens the date');
  assert.equal(upcoming(d, T, 30).find((x) => x.type === 'lend')!.rial, 30_000_000);
});

ok('a shop loan is repaid through the shop’s accounts, a personal one through personal ones', () => {
  const d = book();
  setupBusiness(d, { name: 'کافه نارنج', type: 'cafe', card: 'new', now: Date.now(), today: T });
  const shopCash = d.accounts.find((a) => a.bizId && a.kind === 'cash')!;
  shopCash.openingRial = 100_000_000;
  bookLend(d, { kind: 'lend', person: 'علی', accountId: shopCash.id, amountRial: 5_000_000, date: T, dueOn: '2026-10-12' });
  const due = upcoming(d, T, 30).find((x) => x.type === 'lend')!;
  assert.equal(due.label, 'پس گرفتن قرض از علی (کسب‌وکار)');
  assert.match(settleDue(d, due, 'mellat', T) ?? '', /حساب‌های کسب‌وکار/);
  assert.equal(settleDue(d, due, shopCash.id, T), null);
});

ok('the plan: installments, cheques, bills and loans with people — not expected income — at 09:00 Tehran, N days before', () => {
  const d = book();
  d.incomes.push({ id: 'sal', name: 'حقوق', amountRial: 300_000_000, repeat: 'monthly', day: 1, fromMonth: '1405-8', receivedMonths: [], active: true } as never);
  bookLend(d, { kind: 'lend', person: 'علی', accountId: 'mellat', amountRial: 50_000_000, date: '2026-10-01', dueOn: '2026-10-20' });
  const plan = reminderPlan(d, T, 3);
  assert.ok(!plan.some((r) => r.type === 'income'));
  const car = plan.find((r) => r.key.startsWith('loan:car:1'))!;
  assert.equal(car.date, '2026-10-15');
  assert.equal(car.at, tehranMorning('2026-10-12'));
  assert.equal(new Date(car.at).toISOString(), '2026-10-12T05:30:00.000Z');
  assert.ok(car.id >= REMINDER_ID_BASE && car.id < 2_147_483_647, 'id in the reminder range, a Java int');
  assert.equal(reminderPlan(d, T, 3).find((r) => r.key === car.key)!.id, car.id, 'the same due keeps its id');
  assert.ok(plan.some((r) => r.type === 'lend' && r.date === '2026-10-20'));
  assert.ok(plan.some((r) => r.type === 'bill'));
  const tx = reminderText(car, '2026-10-12');
  assert.equal(tx.title, 'یادآوری: قسط ۱ وام خودرو');
  assert.match(tx.body, /^۳ روز دیگر \(۲۳ مهر\)، پرداخت ۱ میلیون تومان\.$/);
});

ok('phone: future reminders scheduled once; a morning that passed is not shown again; paid → cancelled', () => {
  const d = book();
  let st = emptyReminderState();
  const plan = reminderPlan(d, T, 3);
  const s1 = reminderStep(plan, st, at(T), T, true);
  assert.equal(s1.now.length, 0, 'nothing due yet');
  assert.ok(s1.schedule.some((x) => x.at === tehranMorning('2026-10-12')), 'the installment of the 15th: the morning of the 12th');
  assert.ok(s1.schedule.every((x) => x.at > at(T)));
  st = s1.state;
  // opened again the same day: nothing new
  const s2 = reminderStep(reminderPlan(d, T, 3), st, at(T, '18:00'), T, true);
  assert.deepEqual([s2.now.length, s2.schedule.length, s2.cancel.length], [0, 0, 0]);
  // the 13th: the phone showed the installment on the 12th — not shown again
  const s3 = reminderStep(reminderPlan(d, '2026-10-13', 3), s2.state, at('2026-10-13'), '2026-10-13', true);
  assert.equal(s3.now.length, 0);
  assert.ok(s3.state.done.some((k) => k.startsWith('loan:car:1')));
  // the installment is paid before its reminder (a fresh start): its scheduled reminder is cancelled
  const d2 = book();
  const f1 = reminderStep(reminderPlan(d2, T, 3), emptyReminderState(), at(T), T, true);
  const carId = f1.schedule.find((x) => x.title.includes('قسط ۱'))!.id;
  settleDue(d2, upcoming(d2, T, 30).find((x) => x.type === 'loan')!, 'mellat', T);
  const f2 = reminderStep(reminderPlan(d2, T, 3), f1.state, at(T, '11:00'), T, true);
  assert.ok(f2.cancel.includes(carId));
  // the lead changes: cancelled and scheduled again for the new morning
  // the bill of 25 مهر (2026-10-17): 3 days before = the 14th; 7 days before = the 10th, already this morning → shown now
  const netKey = Object.keys(f2.state.sched).find((k) => k.startsWith('bill:net'))!;
  assert.equal(f2.state.sched[netKey].at, tehranMorning('2026-10-14'));
  const f3 = reminderStep(reminderPlan(d2, T, 7), f2.state, at(T, '12:00'), T, true);
  assert.ok(f3.cancel.includes(f2.state.sched[netKey].id), 'the old morning cancelled');
  assert.ok(f3.now.some((x) => x.title === 'یادآوری: اینترنت'));
  // a longer lead that is still ahead: scheduled again for the new morning
  const f4 = reminderStep(reminderPlan(d2, T, 5), f2.state, at(T, '12:00'), T, true);
  assert.equal(f4.schedule.find((x) => x.title === 'یادآوری: اینترنت')!.at, tehranMorning('2026-10-12'));
});

ok('website (no alarm): shown when its morning has come and the app is opened — once; overdue too; many summarized', () => {
  const d = book();
  let s = reminderStep(reminderPlan(d, T, 3), emptyReminderState(), at(T), T, false);
  assert.equal(s.now.length, 0);
  assert.equal(s.schedule.length, 0, 'nothing scheduled on the website');
  s = reminderStep(reminderPlan(d, '2026-10-12', 3), s.state, at('2026-10-12', '08:00'), '2026-10-12', false);
  assert.equal(s.now.length, 0, 'before 09:00');
  s = reminderStep(reminderPlan(d, '2026-10-12', 3), s.state, at('2026-10-12', '09:30'), '2026-10-12', false);
  assert.deepEqual(
    s.now.map((x) => x.title),
    ['یادآوری: قسط ۱ وام خودرو'],
  );
  s = reminderStep(reminderPlan(d, '2026-10-12', 3), s.state, at('2026-10-12', '20:00'), '2026-10-12', false);
  assert.equal(s.now.length, 0, 'once');
  // five unpaid installments overdue at once: one summary, not five notifications
  const d2 = book();
  d2.loans[0] = { ...d2.loans[0], firstDueDate: '2026-05-15' } as never;
  const many = reminderStep(reminderPlan(d2, T, 3), emptyReminderState(), at(T), T, false);
  assert.equal(many.now.length, 1);
  assert.match(many.now[0].title, /سررسید نزدیک یا گذشته/);
});

ok('reminders off: nothing shown, everything scheduled cancelled', () => {
  const d = book();
  const s1 = reminderStep(reminderPlan(d, T, 3), emptyReminderState(), at(T), T, true);
  const s2 = reminderStep(reminderPlan(d, T, 3), s1.state, at(T, '11:00'), T, true, false);
  assert.deepEqual(s2.cancel.sort(), s1.schedule.map((x) => x.id).sort());
  assert.deepEqual([s2.now.length, s2.schedule.length, Object.keys(s2.state.sched).length], [0, 0, 0]);
});

console.log(`\n${n} reminder checks passed`);
