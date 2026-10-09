/**
 * قرض with people (rule 84): booked as transfers to a person account (never income or spending), the position per
 * person, net worth, business lending kept off the personal side, and the voice dialog (rule 68) — personal vs
 * business asked, never guessed. Run: npx tsx scripts/lending-test.ts
 */
import assert from 'node:assert';
import { setupBusiness } from '../lib/biz/ops';
import { netWorth, totalsBetween } from '../lib/finance/calc';
import { bookLend, lendingSummary, positions } from '../lib/finance/lending';
import { emptyData, isMoneyAccount } from '../lib/finance/model';
import { commitLend, lendAnswer, lendChoose, lendKindIn, lendStart, personIn, undoLend } from '../lib/finance/voice-lend';
import { answerQuestion, parseQuestion } from '../lib/assistant/ask';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-07';
function book(withBiz = false) {
  const d = emptyData(T);
  d.accounts.push({ id: 'mellat', name: 'کارت ملت', kind: 'bank', openingRial: 500_000_000, openedOn: '2026-10-01' });
  if (withBiz) setupBusiness(d, { name: 'کافه نارنج', type: 'cafe', card: 'new', now: Date.now(), today: T });
  return d;
}
const bal = (d: ReturnType<typeof book>, name: string) => positions(d).find((p) => p.account.name === name)?.balanceRial ?? 0;

ok('lend / borrow / repaid / repay are transfers; the person’s balance is the position; not income or spending', () => {
  const d = book();
  assert.equal(typeof bookLend(d, { kind: 'lend', person: 'علی', accountId: 'mellat', amountRial: 50_000_000, date: T }), 'object');
  assert.equal(bal(d, 'علی'), 50_000_000, 'Ali owes 5m toman');
  bookLend(d, { kind: 'repaid', person: 'علي', accountId: 'mellat', amountRial: 20_000_000, date: T }); // Arabic ي: same person
  assert.equal(bal(d, 'علی'), 30_000_000);
  bookLend(d, { kind: 'borrow', person: 'رضا', accountId: 'mellat', amountRial: 10_000_000, date: T });
  assert.equal(bal(d, 'رضا'), -10_000_000, 'the user owes Reza');
  bookLend(d, { kind: 'repay', person: 'رضا', accountId: 'mellat', amountRial: 10_000_000, date: T });
  assert.equal(bal(d, 'رضا'), 0);
  assert.equal(d.accounts.filter((a) => a.kind === 'person').length, 2);
  const t = totalsBetween(d, '2026-10-01', T);
  assert.equal(t.incomeRial + t.expenseRial, 0, 'a loan is neither income nor spending');
  assert.ok(!d.accounts.filter((a) => a.kind === 'person').some(isMoneyAccount));
});

ok('net worth: what people owe is a claim, what the user owes a debt; cash moved accordingly', () => {
  const d = book();
  bookLend(d, { kind: 'lend', person: 'علی', accountId: 'mellat', amountRial: 50_000_000, date: T });
  bookLend(d, { kind: 'borrow', person: 'رضا', accountId: 'mellat', amountRial: 20_000_000, date: T });
  const nw = netWorth(d, [], T);
  assert.equal(nw.cashRial, 500_000_000 - 50_000_000 + 20_000_000);
  assert.equal(nw.receivableRial, 50_000_000);
  assert.equal(nw.debtRial, 20_000_000);
  assert.equal(nw.netRial, 500_000_000, 'lending does not change what the user is worth');
  assert.equal(bookLend(d, { kind: 'lend', person: ' ', accountId: 'mellat', amountRial: 1, date: T }), 'نام طرف قرض را بنویسید.');
});

ok('business lending: from the shop’s account, a business person account, off the personal side and listed apart', () => {
  const d = book(true);
  const till = d.biz!.cashAccountId!;
  bookLend(d, { kind: 'lend', person: 'حسن', accountId: till, amountRial: 10_000_000, date: T });
  bookLend(d, { kind: 'lend', person: 'حسن', accountId: 'mellat', amountRial: 3_000_000, date: T });
  const ps = positions(d).filter((p) => p.account.name === 'حسن');
  assert.equal(ps.length, 2, 'the shop’s Hasan and the user’s Hasan are two positions');
  assert.equal(ps.find((p) => p.business)!.balanceRial, 10_000_000);
  const t = totalsBetween(d, '2026-10-01', T);
  assert.equal(t.incomeRial + t.expenseRial, 0, 'not an owner draw or capital, not spending');
  assert.equal(lendingSummary(d, true).owedToMeRial, 10_000_000);
  assert.equal(lendingSummary(d, false).owedToMeRial, 3_000_000);
});

ok('voice: kind and person from the sentence', () => {
  const d = book();
  assert.equal(lendKindIn('پنج میلیون به علی قرض دادم'), 'lend');
  assert.equal(lendKindIn('دو میلیون از رضا قرض گرفتم'), 'borrow');
  assert.equal(lendKindIn('علی سه میلیون از قرضش رو پس داد'), 'repaid');
  assert.equal(lendKindIn('قرض مریم رو پس دادم'), 'repay');
  assert.equal(lendKindIn('پنجاه هزار تومن نون خریدم'), null);
  assert.equal(personIn(d, 'علی سه میلیون از قرضش رو پس داد', 'repaid'), 'علی');
  assert.equal(personIn(d, 'قرض مریم رو پس دادم', 'repay'), 'مریم');
  assert.equal(personIn(d, 'دو میلیون از رضا قرض گرفتم', 'borrow'), 'رضا');
  assert.equal(lendStart(d, 'کی به من بدهکاره؟'), null, 'a question');
});

ok('voice: one sentence → read back in words → «بله» books it → «برگرداندن» takes it back', () => {
  const d = book();
  let st = lendStart(d, 'پنج میلیون به علی قرض دادم از کارت ملت')!;
  assert.equal(st.asking, 'confirm');
  assert.equal(st.say, 'پنج میلیون تومان به علی قرض دادی، از کارت ملت. ثبت کنم؟');
  st = lendAnswer(d, st, 'آره');
  const u = commitLend(d, st, T);
  assert.equal(typeof u, 'object');
  assert.equal(bal(d, 'علی'), 50_000_000);
  undoLend(d, u as { txnId: string });
  assert.equal(bal(d, 'علی'), 0);
});

ok('voice with a business: «از پول خودت یا از کسب‌وکار؟» is asked, never guessed; «صندوق مغازه» is the shop’s cash', () => {
  const d = book(true);
  let st = lendStart(d, 'به علی دو میلیون قرض دادم')!;
  assert.equal(st.asking, 'side');
  assert.deepEqual(st.options.map((o) => o.key), ['me', 'biz']);
  st = lendChoose(d, st, 'me');
  assert.equal(st.asking, 'account', 'two personal accounts: which one');
  st = lendAnswer(d, st, 'کارت ملت');
  assert.equal(st.asking, 'confirm');
  const shop = lendStart(d, 'از صندوق مغازه به حسن یک میلیون قرض دادم')!;
  assert.equal(shop.asking, 'confirm');
  assert.match(shop.say, /از صندوق کافه نارنج \(حساب کسب‌وکار\)\. ثبت کنم؟/);
  // a repayment goes where the loan is
  bookLend(d, { kind: 'lend', person: 'حسن', accountId: d.biz!.cashAccountId!, amountRial: 10_000_000, date: T });
  const back = lendStart(d, 'حسن پونصد هزار تومن از قرضش رو پس داد')!;
  assert.notEqual(back.asking, 'side', 'Hasan’s loan is the shop’s: no need to ask');
});

ok('voice questions: who owes me, whom I owe, one person; «نسیه» stays the business credit book', () => {
  const d = book();
  bookLend(d, { kind: 'lend', person: 'علی', accountId: 'mellat', amountRial: 50_000_000, date: T });
  bookLend(d, { kind: 'borrow', person: 'رضا', accountId: 'mellat', amountRial: 20_000_000, date: T });
  const ask = (s: string) => {
    const q = parseQuestion(d, s, T);
    assert.ok(q && q.type === 'more', s);
    return answerQuestion(d, [], T, q);
  };
  assert.match(ask('کی به من بدهکاره؟').text, /طلب شما از اشخاص: ۵٬۰۰۰٬۰۰۰ تومان — علی ۵٬۰۰۰٬۰۰۰ تومان/);
  assert.match(ask('به کی بدهکارم؟').text, /بدهی شما به اشخاص: ۲٬۰۰۰٬۰۰۰ تومان — رضا/);
  assert.equal(ask('علی چقدر بهم بدهکاره؟').text, 'علی ۵٬۰۰۰٬۰۰۰ تومان به شما بدهکار است.');
  const db = book(true);
  const q = parseQuestion(db, 'نسیه چقدر طلب دارم؟', T);
  assert.equal(q?.type, 'biz');
});

console.log(`\nlending: ${n} checks OK`);
