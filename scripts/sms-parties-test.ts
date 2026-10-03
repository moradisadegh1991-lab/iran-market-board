/**
 * Pins «مبدا و مقصد» of bank SMS (lib/finance/sms-parties.ts): the other side read from the text,
 * the bank from the sender, the user's own side from the direction the bank stated, suggestions
 * that are only suggestions (rule 45), and the category remembered per counterparty.
 * The message shapes follow common Iranian bank wording; real messages from the user's banks
 * should be added here when available (rule 33).
 * Run: npx tsx scripts/sms-parties-test.ts
 */
import assert from 'node:assert';
import { commitStaged, rowsFromMessages, suggestCategory } from '../lib/finance/importers';
import { emptyData, type FinanceData, type Staged } from '../lib/finance/model';
import { learnSources } from '../lib/finance/sources';
import { bankOf, partiesNote, suggestParties } from '../lib/finance/sms-parties';
import { smsParser } from '../lib/finance/sms';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-03';
const AT = Date.parse('2026-10-02T10:00:00Z');

function book(): FinanceData {
  const d = emptyData(TODAY);
  d.accounts = [
    { id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' },
    { id: 'a-saman', name: 'سامان', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' },
    { id: 'a-cash', name: 'کیف پول نقد', kind: 'cash', openingRial: 0, openedOn: '2026-09-01' },
  ];
  // the user linked card 5678 to their Saman account earlier
  d.smsSources.push({ key: 'card:5678', kind: 'card', ref: '5678', bank: null, accountId: 'a-saman', count: 3, firstAt: 0, lastAt: 0, lastBalanceRial: null, lastBalanceAt: null });
  return d;
}
const row = (body: string, address?: string): Staged => {
  const r = rowsFromMessages([{ body, address, at: AT }], smsParser, TODAY).rows[0];
  assert.ok(r, `no row for ${body}`);
  return r;
};

ok('card-to-card: the other card and its holder are the destination; the sender names the bank', () => {
  const d = book();
  const s = row('انتقال از کارت: *4417\nبه کارت 6219-86**-****-1111 به نام سارا محمدی\nمبلغ 7,000,000 ریال\nمانده: 5,300,000', 'Bank Mellat');
  const p = suggestParties(d, s);
  assert.equal(s.direction, 'out');
  assert.equal(p.bank?.name, 'بانک ملت');
  assert.equal(p.bank?.via, 'sender');
  assert.equal(p.to?.kind, 'card');
  assert.equal(p.to?.ref, '1111');
  assert.equal(p.to?.name, 'سارا محمدی');
  assert.equal(p.from?.kind, 'mine');
  assert.equal(p.transfer, null, 'a stranger’s card is not a transfer');
  assert.equal(p.memoryKey, 'party:سارا محمدی');
});

ok('the other card is one the user linked to another account → suggest a transfer between them', () => {
  const d = book();
  const s = row('انتقال از کارت: *4417\nبه کارت 6037-99**-****-5678 علی رضایی\nمبلغ 25,000,000 ریال', 'Bank Mellat');
  const p = suggestParties(d, s);
  assert.equal(p.to?.kind, 'own-account');
  assert.deepEqual(p.transfer && { c: p.transfer.choice, a: p.transfer.otherAccountId }, { c: 'transfer-out', a: 'a-saman' });
  assert.equal(p.memoryKey, null, 'own transfers teach no category');
});

ok('card purchase: the merchant is the destination', () => {
  const s = row('خرید: 1,250,000 ریال\nکارت: *4417\nپذیرنده: فروشگاه رفاه\nمانده: 12,300,000', 'TejaratBank');
  const p = suggestParties(book(), s);
  assert.equal(p.bank?.name, 'بانک تجارت');
  assert.equal(p.to?.kind, 'merchant');
  assert.equal(p.to?.label, 'فروشگاه رفاه');
  assert.match(p.from!.label, /۴۴۱۷/);
  assert.equal(partiesNote(p), 'به: فروشگاه رفاه');
});

ok('ATM: cash; with exactly one cash wallet a transfer into it is suggested, with two none', () => {
  const s = row('برداشت: 2,000,000 ریال\nکارت: *4417\nخودپرداز ملت شعبه ونک\nمانده: 10,300,000', '30001234');
  const d = book();
  const p = suggestParties(d, s);
  assert.equal(p.to?.kind, 'cash');
  // a numeric short code is never mapped to a bank, and a bare «ملت» (not «بانک ملت») is not read as one
  assert.equal(p.bank, null);
  assert.deepEqual(p.transfer && [p.transfer.choice, p.transfer.otherAccountId], ['transfer-out', 'a-cash']);
  d.accounts.push({ id: 'a-cash2', name: 'صندوق خانه', kind: 'cash', openingRial: 0, openedOn: '2026-09-01' });
  assert.equal(suggestParties(d, s).transfer, null);
});

ok('salary deposit: the source is the employer, the purpose is read, the destination is the user’s account', () => {
  const s = row('واریز 150,000,000 ریال به حساب شما\nبابت: حقوق مهر\nحساب: 1234567890\nمانده: 160,000,000', 'Saman');
  const p = suggestParties(book(), s);
  assert.equal(s.direction, 'in');
  assert.equal(p.from?.kind, 'salary');
  assert.equal(p.to?.kind, 'mine');
  assert.match(p.to!.label, /۱۲۳۴۵۶۷۸۹۰/);
  assert.equal(p.purpose, 'حقوق مهر');
});

ok('deposit from someone’s card: their card and name are the source — and their card is not taken for the user’s', () => {
  const s = row('واریز 5,000,000 ریال\nاز کارت 6219-86**-****-9876 محمد احمدی\nحساب: 1234567890\nمانده: 9,000,000', 'BMI');
  // the shared parser reads «6219» (the sender's card's first digits) as a card; the row drops it
  assert.equal(s.card, null);
  const d = book();
  learnSources(d, [s], AT);
  assert.ok(!d.smsSources.some((x) => x.key === 'card:6219'), 'no phantom card registered');
  const p = suggestParties(d, s);
  assert.equal(p.from?.ref, '9876');
  assert.equal(p.from?.name, 'محمد احمدی');
  assert.equal(p.bank?.name, 'بانک ملی');
});

ok('Paya to an IBAN, installment, bill', () => {
  const sheba = suggestParties(book(), row('انتقال وجه پایا\nبه شبا IR12 0570 0000 0000 1234 5678 01 رضا کریمی\nمبلغ 40,000,000 ریال'));
  assert.equal(sheba.to?.kind, 'sheba');
  assert.equal(sheba.to?.name, 'رضا کریمی');
  const loan = suggestParties(book(), row('بانک ملت\nبرداشت: 900,000 ریال\nحساب: 1234567890\nبابت: قسط وام مسکن'));
  assert.equal(loan.to?.kind, 'loan');
  assert.equal(loan.purpose, 'قسط وام مسکن');
  assert.equal(loan.bank?.via, 'text');
  const bill = suggestParties(book(), row('برداشت: 650,000 ریال\nکارت: *4417\nپرداخت قبض برق'));
  assert.equal(bill.to?.kind, 'bill');
});

ok('which account: suggested only when exactly one account carries the bank’s name, never applied', () => {
  const d = book();
  const s = row('خرید: 1,250,000 ریال\nکارت: *9999\nپذیرنده: نانوایی', 'Bank Mellat');
  assert.equal(s.accountId, null);
  const p = suggestParties(d, s);
  assert.equal(p.account?.accountId, 'a-mellat');
  assert.equal(s.accountId, null, 'the row itself is untouched');
  d.accounts.push({ id: 'a-mellat2', name: 'ملت حقوق', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' });
  assert.equal(suggestParties(d, s).account, null, 'two Mellat accounts: no suggestion');
  // the row already knows its account (card linked): nothing to suggest
  assert.equal(suggestParties(book(), { ...s, accountId: 'a-saman' }).account, null);
});

ok('banks: sender beats text; longer names win over the short ones they contain; unknown senders give nothing', () => {
  assert.equal(bankOf('EDBI', 'برداشت')?.name, 'بانک توسعه صادرات');
  assert.equal(bankOf(null, 'بانک توسعه صادرات ایران: برداشت')?.name, 'بانک توسعه صادرات');
  assert.equal(bankOf(null, 'بانک صادرات: برداشت')?.name, 'بانک صادرات');
  assert.equal(bankOf('+989121234567', 'برداشت: 1,000 ریال'), null);
  assert.equal(bankOf('Saderat', 'بانک ملت')?.name, 'بانک صادرات');
});

ok('no stated direction: no sides are assigned until the user picks the type', () => {
  const s = row('تراکنش کارت شما در بانک ملت به مبلغ 2,400,000 ریال ثبت شد');
  assert.equal(s.direction, null);
  const p = suggestParties(book(), s);
  assert.equal(p.from, null);
  assert.equal(p.to, null);
  assert.equal(p.bank?.name, 'بانک ملت');
});

ok('booking: the note carries «به: …», and the category is remembered for that counterparty', () => {
  const d = book();
  const s = row('خرید: 1,250,000 ریال\nکارت: *4417\nپذیرنده: فروشگاه رفاه', 'TejaratBank');
  d.inbox.push(s);
  const p = suggestParties(d, s);
  assert.equal(commitStaged(d, s.id, { choice: 'expense', accountId: 'a-mellat', categoryId: 'c-food', partiesNote: partiesNote(p), partyKey: p.memoryKey }), null);
  const t = d.txns[d.txns.length - 1];
  assert.match(t.note!, /به: فروشگاه رفاه/);
  assert.equal(d.catMemory['party:فروشگاه رفاه'], 'c-food');
  // the next purchase there — different card, different amount — gets the same category suggested
  const next = row('خرید: 3,100,000 ریال\nکارت: *1212\nپذیرنده: فروشگاه رفاه', 'TejaratBank');
  assert.equal(suggestCategory(d, next, suggestParties(d, next).memoryKey), 'c-food');
  // …but not to every card SMS: «کارت ۴۴۱۷» names no payee and teaches nothing
  assert.equal(d.catMemory['کارت'], undefined);
  const other = row('خرید: 800,000 ریال\nکارت: *4417\nپذیرنده: داروخانه دکتر شریفی', 'TejaratBank');
  assert.notEqual(suggestCategory(d, other, suggestParties(d, other).memoryKey), 'c-food');
});

console.log(`\nsms-parties: ${n} checks OK`);
