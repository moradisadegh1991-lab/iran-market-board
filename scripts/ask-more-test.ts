/**
 * The assistant's wider coverage (rule 85, lib/assistant/ask-more.ts): opening a page, a price alert (offered,
 * done only on «بله» — the action is returned, never applied here), budget, due dates, goals, and that a
 * transaction or a loan being told is never taken for one of these questions.
 * Run: npx tsx scripts/ask-more-test.ts
 */
import assert from 'node:assert';
import { answerQuestion, parseQuestion } from '../lib/assistant/ask';
import { answerMore, parseMore } from '../lib/assistant/ask-more';
import { emptyData, type FinanceData } from '../lib/finance/model';
import { lendStart } from '../lib/finance/voice-lend';
import { colloquial, speakable } from '../lib/voice-io';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-04'; // ۱۲ مهر ۱۴۰۵

function book(): FinanceData {
  const d = emptyData(T);
  d.accounts.push({ id: 'a-mellat', name: 'بانک ملت', kind: 'bank', openingRial: 500_000_000, openedOn: '2026-01-01' });
  d.budgets.push({ categoryId: 'c-food', monthlyRial: 100_000_000 });
  d.txns.push({ id: 't1', date: '2026-09-25', kind: 'expense', amountRial: 30_000_000, accountId: 'a-mellat', toAccountId: null, categoryId: 'c-food' });
  d.loans.push({ id: 'l1', name: 'وام مسکن', direction: 'borrowed', principalRial: 1_200_000_000, annualRatePct: 0, months: 12, firstDueDate: '2026-10-10', paidCount: 0 });
  d.goals.push({ id: 'g1', name: 'خرید ماشین', targetRial: 10_000_000_000, targetDate: '2028-10-01', savedRial: 2_000_000_000, inflationAdjust: false });
  return d;
}
const more = (d: FinanceData, s: string) => parseMore(d, s, T);
const reply = (d: FinanceData, s: string) => {
  const q = more(d, s);
  assert.ok(q, `not understood: ${s}`);
  return answerMore(d, [], T, q, Date.parse(T));
};

ok('opening a page: by its menu name or an everyday word; asked, not done («… را باز کنم؟»)', () => {
  const d = book();
  for (const [s, href] of [
    ['بودجه رو باز کن', '/budget'],
    ['تنظیمات رو باز کن', '/settings'],
    ['برو به تنظیمات کسب و کار', '/biz/settings'],
    ['یادآوری‌ها رو نشونم بده صفحه', '/settings'],
    ['برو به صندوق خانگی', '/fund'],
    ['دنگ رو باز کن', '/split'],
    ['صفحه نمودار', '/charts'],
    ['برو به تراکنش ها', '/transactions'],
  ] as const) {
    const q = more(d, s);
    assert.equal(q?.type, 'nav', s);
    assert.equal(q?.type === 'nav' && q.href, href, s);
  }
  const r = reply(d, 'بودجه رو باز کن');
  assert.equal(r.action?.type, 'nav');
  assert.match(r.text, /باز کنم؟$/);
  assert.equal(more(d, 'برو قرض علی رو ثبت کن'), null, 'a loan being told is not a page');
});

ok('a price alert: asset, amount and direction from the sentence; the board’s unit; offered with «بله»', () => {
  const d = book();
  const up = more(d, 'هر وقت دلار به سیصد هزار تومن رسید خبرم کن');
  assert.ok(up && up.type === 'alert');
  assert.equal(up.asset.key, 'usd');
  assert.equal(up.dir, 'above');
  assert.equal(up.value, 300_000, 'toman, the board’s unit for the dollar');
  const down = more(d, 'اگه طلا زیر هفت میلیون اومد بهم بگو');
  assert.ok(down && down.type === 'alert');
  assert.equal(down.dir, 'below');
  assert.equal(down.value, 7_000_000);
  const btc = more(d, 'بیت کوین بالای صد و پنجاه هزار دلار رفت خبرم کن');
  assert.ok(btc && btc.type === 'alert');
  assert.equal(btc.asset.key, 'btc');
  assert.equal(btc.value, 150_000, 'dollars for the coins (rule 2)');
  const r = reply(d, 'هر وقت دلار به سیصد هزار تومن رسید خبرم کن');
  assert.deepEqual(r.action && { ...r.action, label: undefined }, { type: 'alert', asset: 'usd', dir: 'above', value: 300_000, label: undefined });
  assert.match(r.text, /فقط وقتی اپ باز است/, 'rule 15: no promise while the app is closed');
  assert.ok(!/[0-9۰-۹]/.test(r.speech), 'spoken in words');
  assert.equal(more(d, 'دلار رسید خبرم کن'), null, 'no amount: not an alert');
});

ok('budget: one category or all of it, from the month’s own spending', () => {
  const d = book();
  const r = reply(d, 'از بودجه خوراک چقدر مونده؟');
  assert.match(r.text, /بودجه خوراک این ماه: ۱۰٬۰۰۰٬۰۰۰ تومان؛ خرج ۳٬۰۰۰٬۰۰۰ تومان/);
  assert.match(r.text, /۷٬۰۰۰٬۰۰۰ تومان مانده/);
  assert.match(r.speech, /هفت میلیون/);
  d.budgets.push({ categoryId: 'c-transport', monthlyRial: 50_000_000 });
  const all = reply(d, 'بودجه این ماه چقدره؟');
  assert.match(all.text, /^بودجه این ماه: ۱۵٬۰۰۰٬۰۰۰ تومان، خرج ۳٬۰۰۰٬۰۰۰ تومان، مانده ۱۲٬۰۰۰٬۰۰۰ تومان/);
  assert.equal(reply(emptyData(T), 'بودجه چقدر مونده؟').text, 'هنوز بودجه‌ای تعریف نکرده‌اید.');
});

ok('due dates: the next installment with its day; what is owed this week/month', () => {
  const d = book();
  const next = reply(d, 'قسط بعدیم کیه؟');
  assert.match(next.text, /وام مسکن/);
  assert.match(next.text, /۱۰٬۰۰۰٬۰۰۰ تومان/);
  const week = more(d, 'این هفته چی باید بدم؟');
  assert.ok(week && week.type === 'dues' && week.days === 7);
  assert.match(reply(d, 'این هفته چی باید بدم؟').text, /وام مسکن/, '۱۰ مهر… the 10th is within 7 days of the 4th');
  assert.match(reply(d, 'چک های این ماه چیه؟').text, /چکی ندارید/);
});

ok('goals: progress and what is needed each month', () => {
  const d = book();
  const r = reply(d, 'هدف خرید ماشین چقدر پیش رفته؟');
  assert.match(r.text, /^خرید ماشین: ۲۰٪/);
  assert.match(r.text, /ماه مانده، ماهی .* لازم است/);
  assert.equal(reply(emptyData(T), 'هدفام چطوره؟').text, 'هنوز هدفی تعریف نکرده‌اید.');
});

ok('through the assistant: the same answers via ask.ts; a transaction or a loan stays a transaction', () => {
  const d = book();
  const q = parseQuestion(d, 'از بودجه خوراک چقدر مونده؟', T);
  assert.equal(q?.type, 'more');
  const r = answerQuestion(d, [], T, q!, Date.parse(T));
  assert.match(r.text, /بودجه خوراک/);
  assert.equal(parseQuestion(d, 'پنجاه هزار تومن قسط دادم از ملت', T), null, 'a payment told is a transaction');
  assert.equal(parseQuestion(d, 'به علی پنج میلیون قرض دادم', T), null);
  assert.ok(lendStart(d, 'به علی پنج میلیون قرض دادم'), 'and the loan dialog takes it');
});

ok('spoken: the short «ثبت شد / ثبت کنم؟» said as a person says them, only as a clause of their own (rule 86)', () => {
  const say = (t: string) => colloquial(speakable(t));
  assert.equal(say('ثبت شد.'), 'ثبتش کردم.');
  assert.equal(say('ثبت شد؛ فاکتور ۱.'), 'ثبتش کردم؛ فاکتور یک.');
  assert.match(say('دو تا لاته، کارت. ثبت کنم؟'), /کارت\. ثبتش کنم؟$/);
  assert.equal(say('چه تراکنشی ثبت کنم؟'), 'چه تراکنشی ثبت کنم؟', 'the object stays');
  assert.equal(say('قسط ثبت شد.'), 'قسط ثبت شد.');
});

console.log(`\n${n} ✓ — ask-more`);
