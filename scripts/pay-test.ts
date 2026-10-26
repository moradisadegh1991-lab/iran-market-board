/**
 * شارژ، بسته اینترنت و پرداخت قبض (lib/finance/pay.ts, rule 106): the operator from the prefix (a suggestion, unknown ones
 * asked), bill IDs checked with the bill control digits (persian-tools' algorithm) and their service and amount read; one
 * expense named after the request; the bank SMS already booked or queued becomes that payment, not a second one; a tracked
 * bill is marked paid only when picked; «برگرداندن» undoes exactly that.
 * Run: npx tsx scripts/pay-test.ts
 */
import assert from 'node:assert';
import { emptyData, type FinanceData, type PayRequest } from '../lib/finance/model';
import {
  billFromText,
  checkBill,
  checkDigit,
  completeRequest,
  favorites,
  makeRequest,
  maskMobile,
  normalizeMobile,
  operatorOf,
  payMatches,
  requestTitle,
  trackedBillCandidates,
  undoComplete,
  ussdHref,
} from '../lib/finance/pay';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-26';
const NOW = Date.parse(`${TODAY}T12:00:00+03:30`);
const book = (): FinanceData => {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 50_000_000, openedOn: '2026-10-01' });
  return d;
};
/** a valid bill: the ID (… type, control) and a payment ID for `toman` (… year, period, two controls) */
function makeBill(prefix: string, type: number, toman: number, year = 5, period = '08') {
  const bBody = `${prefix}${type}`;
  const billId = bBody + checkDigit(bBody);
  const pBody = `${toman / 100}${year}${period}`;
  const c1 = checkDigit(pBody);
  const c2 = checkDigit(billId + pBody + c1);
  return { billId, paymentId: `${pBody}${c1}${c2}` };
}

ok('numbers in any shape; the operator suggested from the prefix, unknown ones asked', () => {
  assert.deepEqual(['۰۹۱۲ ۳۴۵ ۶۷۸۹', '+989353456789', '00989213456789', '9013456789', '0912345678', '021-12345678'].map(normalizeMobile), ['09123456789', '09353456789', '09213456789', '09013456789', null, null]);
  assert.deepEqual(['09123456789', '09353456789', '09213456789', '09903456789', '09983456789'].map(operatorOf), ['mci', 'irancell', 'rightel', 'mci', null]);
  assert.equal(maskMobile('09353456789'), '\u20660935…6789\u2069');
  assert.equal(typeof makeRequest({ kind: 'charge', mobile: '09983456789', amountRial: 500_000 }), 'string', 'unknown prefix: asked');
  const r = makeRequest({ kind: 'charge', mobile: '09983456789', operator: 'irancell', amountRial: 500_000 }) as PayRequest;
  assert.equal(r.operator, 'irancell', 'the user says it');
  assert.equal(typeof makeRequest({ kind: 'package', mobile: '09123456789', amountRial: 1 }), 'string', 'a package needs its name');
});

ok('the bill control digits (persian-tools\' algorithm): checkDigit by hand, type and amount from the IDs, wrong digits refused', () => {
  // 6·2 + 5·3 + 4·4 + 3·5 + 2·6 + 1·7 = 77 → 77 mod 11 = 0 → 0
  assert.equal(checkDigit('123456'), 0);
  // 9·2 + 1·3 = 21 → 10 → 11 − 10 = 1
  assert.equal(checkDigit('19'), 1);
  const w = makeBill('12345678', 2, 384_500);
  const c = checkBill(w.billId, w.paymentId);
  assert.deepEqual([c.validBillId, c.validPayment, c.type, c.typeFa, c.amountRial, c.errors], [true, true, 2, 'برق', 3_845_000, []]);
  for (const [t, fa] of [[1, 'آب'], [3, 'گاز'], [4, 'تلفن ثابت']] as const) assert.equal(checkBill(makeBill('5550001', t, 120_000).billId, makeBill('5550001', t, 120_000).paymentId).typeFa, fa);
  // one wrong digit anywhere
  const badBill = w.billId.slice(0, 3) + ((Number(w.billId[3]) + 1) % 10) + w.billId.slice(4);
  assert.equal(checkBill(badBill, w.paymentId).validBillId, false);
  const badPay = w.paymentId.slice(0, 1) + ((Number(w.paymentId[1]) + 1) % 10) + w.paymentId.slice(2);
  assert.equal(checkBill(w.billId, badPay).validPayment, false);
  // a payment ID of another bill
  const other = makeBill('87654321', 2, 384_500);
  assert.equal(checkBill(w.billId, other.paymentId).validPayment, false);
  assert.equal(typeof makeRequest({ kind: 'bill', billId: w.billId, paymentId: badPay }), 'string');
  // Persian digits as typed
  const fa = (s: string) => s.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)]);
  assert.equal(checkBill(fa(w.billId), fa(w.paymentId)).validPayment, true);
});

ok('the IDs from a pasted bill SMS or a barcode', () => {
  const w = makeBill('12345678', 3, 96_000);
  const fa = (s: string) => s.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)]);
  assert.deepEqual(billFromText(`قبض گاز\nشناسه قبض: ${fa(w.billId)}\nشناسه پرداخت: ${w.paymentId}\nمبلغ: ۹۶۰۰۰ تومان`), w);
  const barcode = w.billId.padStart(13, '0') + '000' + w.paymentId.padStart(10, '0');
  assert.deepEqual(billFromText(barcode), w);
  assert.equal(billFromText('سلام'), null);
});

ok('the transaction is named after the request; one expense; tracking code in the note; history for «تکرار»', () => {
  const d = book();
  const r = makeRequest({ kind: 'charge', mobile: '09353456789', amountRial: 1_000_000 }, NOW) as PayRequest;
  assert.equal(requestTitle(r), 'شارژ ایرانسل \u20660935…6789\u2069');
  d.payRequests!.push(r);
  const rc = completeRequest(d, r.id, { accountId: 'a-mellat', date: TODAY, trackingCode: ' 123 456 ' }, NOW);
  assert.ok(typeof rc !== 'string');
  assert.equal(d.txns.length, 1);
  assert.deepEqual([d.txns[0].kind, d.txns[0].amountRial, d.txns[0].categoryId, d.txns[0].note], ['expense', 1_000_000, 'c-bills', 'شارژ ایرانسل \u20660935…6789\u2069 — کد پیگیری 123456']);
  assert.deepEqual([r.status, r.txnId], ['done', d.txns[0].id]);
  assert.equal(typeof completeRequest(d, r.id, { accountId: 'a-mellat', date: TODAY }, NOW), 'string', 'not twice');
  const p = makeRequest({ kind: 'package', mobile: '09123456789', label: ' ۳۰ روزه  ۲۰ گیگ ', amountRial: 2_500_000 }, NOW) as PayRequest;
  assert.equal(requestTitle(p), 'بسته اینترنت همراه اول ۳۰ روزه ۲۰ گیگ (\u20660912…6789\u2069)');
  d.payRequests!.push(p);
  // the package really cost a little more: the amount paid is booked
  completeRequest(d, p.id, { accountId: 'a-mellat', date: TODAY, amountRial: 2_600_000 }, NOW + 1);
  assert.equal(d.txns.find((t) => t.id === p.txnId)!.amountRial, 2_600_000);
  const r2 = makeRequest({ kind: 'charge', mobile: '09353456789', amountRial: 1_000_000 }, NOW + 2) as PayRequest;
  d.payRequests!.push(r2);
  completeRequest(d, r2.id, { accountId: 'a-mellat', date: TODAY }, NOW + 2);
  assert.deepEqual(favorites(d).map((f) => [f.request.kind, f.count]), [['charge', 2], ['package', 1]]);
});

ok('the bank SMS of this payment: booked already → that transaction becomes the request; queued → taken from the queue; undo', () => {
  const d = book();
  d.txns.push({ id: 't-sms', date: TODAY, kind: 'expense', amountRial: 1_000_000, accountId: 'a-mellat', categoryId: 'c-other', note: 'خرید اینترنتی', time: '10:00' });
  const r = makeRequest({ kind: 'charge', mobile: '09353456789', amountRial: 1_000_000 }, NOW) as PayRequest;
  d.payRequests!.push(r);
  assert.deepEqual(payMatches(d, 1_000_000, TODAY).txns.map((t) => t.id), ['t-sms']);
  const rc = completeRequest(d, r.id, { accountId: 'a-mellat', date: TODAY, linkTxnId: 't-sms' }, NOW) as never;
  assert.deepEqual([d.txns.length, d.txns[0].categoryId], [1, 'c-bills']);
  assert.match(d.txns[0].note!, /^شارژ ایرانسل/);
  assert.deepEqual(payMatches(d, 1_000_000, TODAY).txns, [], 'a transaction already used by a request is not offered again');
  undoComplete(d, rc);
  assert.deepEqual([d.txns[0].note, d.txns[0].categoryId, r.status], ['خرید اینترنتی', 'c-other', 'pending']);
  d.inbox.push({ id: 's1', source: 'sms', date: TODAY, amountRial: 2_000_000, direction: 'out', why: 'برداشت', description: 'پرداخت قبض', raw: 'x', importedAt: NOW });
  const w = makeBill('12345678', 1, 200_000);
  const b = makeRequest({ kind: 'bill', billId: w.billId, paymentId: w.paymentId }, NOW) as PayRequest;
  assert.equal(b.amountRial, 2_000_000);
  d.payRequests!.push(b);
  const rb = completeRequest(d, b.id, { accountId: 'a-mellat', date: TODAY, stagedId: 's1' }, NOW) as never;
  assert.deepEqual([d.inbox.length, d.txns.length], [0, 2]);
  undoComplete(d, rb);
  assert.deepEqual([d.inbox.length, d.txns.length, b.status], [1, 1, 'pending']);
});

ok('a tracked bill is offered by its service or amount, marked paid for the month only when picked, and undone', () => {
  const d = book();
  d.bills.push({ id: 'b-elec', name: 'برق خانه', amountRial: 3_000_000, dueDay: 10, categoryId: 'c-bills', paidMonths: [], active: true });
  d.bills.push({ id: 'b-net', name: 'اینترنت', amountRial: 1_500_000, dueDay: 5, categoryId: 'c-bills', paidMonths: [], active: true });
  const w = makeBill('12345678', 2, 384_500);
  const r = makeRequest({ kind: 'bill', billId: w.billId, paymentId: w.paymentId }, NOW) as PayRequest;
  d.payRequests!.push(r);
  assert.deepEqual(trackedBillCandidates(d, r).map((b) => b.id), ['b-elec']);
  const rc = completeRequest(d, r.id, { accountId: 'a-mellat', date: TODAY, billRefId: 'b-elec' }, NOW) as never;
  assert.deepEqual(d.bills[0].paidMonths, ['1405-8']);
  assert.deepEqual(d.txns[0].link, { type: 'bill', id: 'b-elec' });
  assert.match(d.txns[0].note!, /^قبض برق — شناسه/);
  undoComplete(d, rc);
  assert.deepEqual([d.bills[0].paidMonths, d.txns.length], [[], 0]);
  // without picking, nothing is marked
  completeRequest(d, r.id, { accountId: 'a-mellat', date: TODAY }, NOW);
  assert.deepEqual([d.bills[0].paidMonths, d.txns[0].link], [[], undefined]);
});

ok('the bank code: only star codes dial, «#» encoded', () => {
  assert.equal(ussdHref('*780#'), 'tel:*780%23');
  assert.equal(ussdHref('*۷۳۳#'), 'tel:*733%23');
  assert.equal(ussdHref('*780*1#'), 'tel:*780*1%23');
  for (const bad of ['780', 'tel:123', '*780', 'javascript:alert(1)', '*7a0#']) assert.equal(ussdHref(bad), null, bad);
});

console.log(`\n${n} pay checks passed`);
