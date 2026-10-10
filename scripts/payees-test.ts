/**
 * دفترچه شماره کارت و شبا (rule 92): card (Luhn + BIN), شبا (mod 97 + bank code, account inside for three banks), account
 * numbers, the book itself, backup round-trip, and nothing of it reaching the advisor (rule 7).
 * Run: npx tsx scripts/payees-test.ts
 */
import assert from 'node:assert';
import { cardInfo, cleanDigits, guessKind, luhnOk, shebaChecksumOk, shebaInfo } from '../lib/finance/bank-ids';
import { addNumber, numberText, removeNumber, searchPayees } from '../lib/finance/payees';
import { emptyData, normalizeData } from '../lib/finance/model';
import { advisorSummary } from '../lib/finance/calc';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-10';

/** an independent Luhn: the digit that completes 15 digits */
function luhnComplete(d15: string): string {
  for (let c = 0; c <= 9; c++) {
    const s = d15 + c;
    const sum = [...s].reverse().reduce((acc, ch, i) => {
      let x = +ch;
      if (i % 2 === 1) x = x * 2 > 9 ? x * 2 - 9 : x * 2;
      return acc + x;
    }, 0);
    if (sum % 10 === 0) return s;
  }
  throw new Error('no digit');
}
/** an independent IBAN builder: check = 98 − (bban · 'IR00') mod 97, with BigInt */
function iban(bban22: string): string {
  const check = 98n - (BigInt(bban22 + '182700') % 97n);
  return `IR${check.toString().padStart(2, '0')}${bban22}`;
}

ok('digits: Persian and Arabic digits, spaces, dashes and half-spaces', () => {
  assert.equal(cleanDigits('۶۰۳۷-۹۹ ٩٩‌12'), '6037999912');
  assert.equal(cleanDigits('ir06 0120'), 'IR060120');
});

ok('card: Luhn check, bank from the first six digits, merged banks said, one wrong digit caught', () => {
  const melli = luhnComplete('603799123456789');
  const c = cardInfo(melli.replace(/(\d{4})/g, '$1 '));
  assert.deepEqual([c.ok, c.bank, c.formatted], [true, 'بانک ملی ایران', melli.replace(/(\d{4})(?=\d)/g, '$1-')]);
  const typo = melli.slice(0, 10) + ((+melli[10] + 1) % 10) + melli.slice(11);
  assert.equal(cardInfo(typo).ok, false, 'one digit changed');
  assert.match(cardInfo(typo).problem!, /رقم کنترل/);
  const swapped = melli.slice(0, 3) + melli[4] + melli[3] + melli.slice(5);
  if (melli[3] !== melli[4]) assert.equal(luhnOk(swapped), false, 'two neighbours swapped');
  assert.match(cardInfo('60379912').problem!, /۱۶ رقم/);
  assert.equal(cardInfo(luhnComplete('610433000011112')).bank, 'بانک ملت');
  assert.equal(cardInfo(luhnComplete('627381000011112')).bank, 'بانک انصار (ادغام‌شده در بانک سپه)');
  assert.equal(cardInfo(luhnComplete('123456000011112')).bank, null, 'unknown BIN: no bank, still a valid number');
});

ok('شبا: mod 97 (same as an independent BigInt build), bank from digits 5–7, 24 digits without IR accepted', () => {
  for (const b of ['0170000000123456789012', '0120020000000010450741', '0560000000000000000001']) {
    const x = iban(b);
    assert.equal(shebaChecksumOk(x), true, x);
    assert.equal(shebaInfo(x.slice(2)).iban, x, 'without IR');
  }
  assert.equal(shebaInfo(iban('0170000000123456789012')).bank, 'بانک ملی ایران');
  assert.equal(shebaInfo(iban('0120020000000010450741')).bank, 'بانک ملت');
  const good = iban('0180000000123456789012');
  const bad = good.slice(0, 20) + ((+good[20] + 1) % 10) + good.slice(21);
  assert.equal(shebaInfo(bad).ok, false);
  assert.match(shebaInfo(bad).problem!, /رقم‌های کنترل/);
  assert.match(shebaInfo('IR12 3456').problem!, /۲۴ رقم/);
  assert.equal(shebaInfo(good).formatted, good.replace(/(.{4})(?=.)/g, '$1 '));
});

ok('شبا → account number: only for Parsian, Pasargad, Shahr (persian-tools rules), none for the others', () => {
  // the examples in the persian-tools README
  assert.equal(shebaInfo('IR820540102680020817909002').account, '002-00817909-002');
  assert.equal(shebaInfo('IR550570022080013447370101').account, '220-800-13447370-1');
  assert.equal(shebaInfo(iban('0610000000000700796858044')).problem !== null, true, '25 digits: refused');
  assert.equal(shebaInfo(iban('0610000000000700796858')).account, '700796858');
  assert.equal(shebaInfo(iban('0120020000000010450741')).account, null, 'Mellat: not read');
});

ok('what a pasted number is', () => {
  assert.deepEqual(
    ['IR06…', '۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۰', '012002000000001045074100', '0102680020817'].map((x) => guessKind(x)),
    ['sheba', 'card', 'sheba', 'account'],
  );
});

ok('the book: per person, a wrong number refused, the same number once, search by name or digits, backup, never to the advisor', () => {
  const d = emptyData(T);
  const card = luhnComplete('603799123456789');
  const sheba = iban('0120020000000010450741');
  assert.equal(typeof addNumber(d, 'علی رضایی', card), 'object');
  assert.equal(typeof addNumber(d, 'علي  رضايي', sheba, { label: 'حساب حقوق' }), 'object', 'same person despite ي and spaces');
  assert.equal(typeof addNumber(d, 'علی رضایی', card.replace(/(\d{4})/g, '$1-')), 'object');
  assert.equal(d.payees!.length, 1);
  assert.equal(d.payees![0].numbers.length, 2, 'the same card once');
  const bad = card.slice(0, 15) + ((+card[15] + 1) % 10);
  assert.match(addNumber(d, 'سارا', bad) as string, /رقم کنترل/);
  assert.equal(d.payees!.length, 1, 'nothing kept for a refused number');
  const acc = addNumber(d, 'سارا', '0102680020817', { bank: 'ملت' });
  assert.ok(typeof acc === 'object' && acc.kind === 'account' && acc.bank === 'ملت');
  assert.deepEqual(searchPayees(d, 'سار').map((p) => p.name), ['سارا']);
  assert.deepEqual(searchPayees(d, card.slice(-4)).map((p) => p.name), ['علی رضایی'], 'by the last four digits');
  assert.equal(numberText(d.payees![0], d.payees![0].numbers[1]), `علی رضایی — شبا ${sheba.replace(/(.{4})(?=.)/g, '$1 ')} (بانک ملت)`);
  const back = normalizeData(JSON.parse(JSON.stringify(d)), T);
  assert.deepEqual(back.payees, d.payees, 'kept through a backup');
  assert.deepEqual(normalizeData({ ...JSON.parse(JSON.stringify(d)), payees: undefined }, T).payees, [], 'an old backup');
  const sent = JSON.stringify(advisorSummary(d, [], T));
  for (const s of [card, card.slice(-8), sheba, '0102680020817', 'رضایی', 'سارا']) assert.ok(!sent.includes(s), `advisor sees no ${s}`);
  removeNumber(d, d.payees![0].id, d.payees![0].numbers[0].id);
  assert.equal(d.payees![0].numbers.length, 1);
});

console.log(`\n${n} payee checks passed`);
