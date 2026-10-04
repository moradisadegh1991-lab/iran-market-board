/**
 * Pins the Persian voice assistant for transactions (lib/finance/voice.ts): spoken amounts and dates,
 * the questions it asks for what is missing, the read-back, corrections, and that what it records is
 * exactly what was confirmed. Kind is never guessed from the category (CLAUDE.md rule 3).
 * Run: npx tsx scripts/voice-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { emptyData, type FinanceData } from '../lib/finance/model';
import { amountIn, amountWords, answer, choose, commitVoice, dateIn, kindIn, numberValue, numToWords, readBack, startVoice, tokens, type VoiceState } from '../lib/finance/voice';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-04'; // ۱۲ مهر ۱۴۰۵, a Sunday (یکشنبه)
const toman = (s: string) => {
  const a = amountIn(tokens(s), false);
  return a ? a.rial / 10 : null;
};

function book(): FinanceData {
  const d = emptyData(T);
  d.accounts.push({ id: 'a-mellat', name: 'بانک ملت', kind: 'bank', openingRial: 0, openedOn: T }, { id: 'a-resalat', name: 'قرض‌الحسنه رسالت', kind: 'bank', openingRial: 0, openedOn: T });
  d.smsSources.push({ key: 'card:4417', kind: 'card', ref: '4417', bank: 'ملت', accountId: 'a-mellat', count: 3, firstAt: 0, lastAt: 0, lastBalanceRial: null, lastBalanceAt: null });
  return d;
}
/** Says each line in turn; returns the final state. */
function talk(d: FinanceData, ...lines: (string | string[])[]): VoiceState {
  let st = startVoice(d, T);
  for (const l of lines) st = answer(d, T, st, l);
  return st;
}

ok('spoken amounts: words, colloquial forms, halves, digits, glued words, rial', () => {
  const cases: [string, number][] = [
    ['پنجاه هزار تومن', 50_000],
    ['پنجاه هزار تومان', 50_000],
    ['دو میلیون و پانصد هزار تومان', 2_500_000],
    ['دو میلیون و پونصد', 2_500_000], // what people say for 2.5 million
    ['یک میلیون و دویست', 1_200_000],
    ['یه میلیون و بیست', 1_020_000],
    ['یک و نیم میلیون', 1_500_000],
    ['دو میلیون و نیم', 2_500_000],
    ['نیم میلیون', 500_000],
    ['صد و بیست و پنج هزار', 125_000],
    ['صدوبیست هزار', 120_000],
    ['پنجاهزار تومن', 50_000],
    ['۲٫۵ میلیون تومان', 2_500_000],
    ['2.5 میلیون', 2_500_000],
    ['۱۵۰ هزار', 150_000],
    ['۱,۲۵۰,۰۰۰ تومان', 1_250_000],
    ['۱۲۵۰۰۰۰', 1_250_000],
    ['هزار و پونصد تومن', 1_500],
    ['سیصد و هفتاد و پنج هزار', 375_000],
    ['چهل و هشت میلیون', 48_000_000],
    ['یک میلیارد و دویست میلیون', 1_200_000_000],
    ['۱۲۰۰۰۰ ریال', 12_000],
    ['هفتصد و پنجاه هزار ریال', 75_000],
    ['شیشصد هزار', 600_000],
    ['دیروز سی و پنج هزار تومن نون خریدم', 35_000],
  ];
  for (const [s, v] of cases) assert.equal(toman(s), v, s);
  // a card number, a time, a count are not the amount
  assert.equal(toman('با کارت ۴۴۱۷ دو تا نون ده هزار تومن'), 10_000);
  assert.equal(toman('ساعت ۵ سی هزار تومن'), 30_000);
  assert.equal(amountIn(tokens('یه نون خریدم'), true), null, '«یه» alone is not an amount');
  assert.equal(amountIn(tokens('نه'), true), null);
});

ok('the read-back says amounts in words that read back to the same number', () => {
  assert.equal(numToWords(2_500_000), 'دو میلیون و پانصد هزار');
  assert.equal(numToWords(1_000), 'هزار');
  assert.equal(numToWords(1_250_075), 'یک میلیون و دویست و پنجاه هزار و هفتاد و پنج');
  assert.equal(amountWords(500_000), 'پنجاه هزار تومان');
  assert.equal(amountWords(12_345), 'دوازده هزار و سیصد و چهل و پنج ریال');
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let i = 0; i < 3000; i++) {
    const v = Math.floor(rnd() ** 3 * 5e9);
    if (v >= 1e6 && Math.floor(v / 1e3) % 1e3 === 0 && v % 1e3) continue; // «یک میلیون و پانصد» is said for 1.5 million — by design
    assert.equal(numberValue(tokens(numToWords(v)))?.value, v, `${v} → ${numToWords(v)}`);
  }
});

ok('spoken dates: relative days, weekdays, «دوازدهم مهر», never ahead of today', () => {
  const at = (s: string) => dateIn(s, T)?.iso ?? null;
  assert.equal(at('امروز'), T);
  assert.equal(at('دیروز ناهار'), '2026-10-03');
  assert.equal(at('دیشب'), '2026-10-03');
  assert.equal(at('پریروز'), '2026-10-02');
  assert.equal(at('سه روز پیش'), '2026-10-01');
  assert.equal(at('۱۰ روز قبل'), '2026-09-24');
  assert.equal(at('هفته پیش'), '2026-09-27');
  assert.equal(at('شنبه'), '2026-10-03');
  assert.equal(at('سه‌شنبه'), '2026-09-29');
  assert.equal(at('سه شنبه'), '2026-09-29');
  assert.equal(at('پنج‌شنبه'), '2026-10-01');
  assert.equal(at('یکشنبه'), T, 'today is Sunday');
  assert.equal(at('یکشنبه گذشته'), '2026-09-27');
  assert.equal(at('دوازدهم مهر'), T);
  assert.equal(at('۱۰ مهر'), '2026-10-02');
  assert.equal(at('اول مهر'), '2026-09-23');
  assert.equal(at('بیست و یکم شهریور'), '2026-09-12');
  assert.equal(at('سی ام شهریور'), '2026-09-21');
  assert.equal(at('۲۰ آبان'), '2025-11-11', 'a month not yet come this year → last year');
  assert.equal(at('۵ مهر ۱۴۰۴'), '2025-09-27');
  assert.equal(at('سی هزار تومن'), null);
  // the date words do not leak into the amount
  assert.equal(toman('سه روز پیش بیست هزار'), 20_000);
  assert.equal(toman('سه شنبه چهل هزار تومن'), 40_000);
});

ok('kind comes only from what was said; a category word alone does not set it (rule 3)', () => {
  assert.equal(kindIn('نون خریدم'), 'expense');
  assert.equal(kindIn('قبض برق پرداخت کردم'), 'expense');
  assert.equal(kindIn('حقوقم اومد'), 'income');
  assert.equal(kindIn('حقوق گرفتم'), 'income');
  assert.equal(kindIn('از علی گرفتم'), null, '«گرفتم» alone also means «bought»');
  assert.equal(kindIn('واریز شد به حسابم'), 'income');
  assert.equal(kindIn('از ملت به نقد منتقل کردم'), 'transfer');
  assert.equal(kindIn('حقوق دو میلیون'), null);
  assert.equal(kindIn('اسنپ'), null);
  const st = talk(book(), 'حقوق بیست میلیون به ملت');
  assert.equal(st.asking, 'kind', 'asks instead of assuming income');
  assert.equal(answer(book(), T, st, 'درآمد').draft.categoryId, 'i-salary');
});

ok('one sentence with everything → straight to the read-back; «بله» records exactly that', () => {
  const d = book();
  let st = talk(d, 'دیروز سی و پنج هزار تومن نون خریدم از کیف پول نقد');
  assert.equal(st.asking, 'confirm');
  assert.equal(st.say, 'سی و پنج هزار تومان هزینه، دسته خوراک، از کیف پول نقد، دیروز، بابت نون. ثبت کنم؟');
  st = answer(d, T, st, 'آره ثبت کن');
  assert.equal(st.done, 'save');
  const t = commitVoice(d, st)!;
  assert.deepEqual({ ...t, id: 'x' }, { id: 'x', date: '2026-10-03', kind: 'expense', amountRial: 350_000, accountId: 'a-cash', toAccountId: null, categoryId: 'c-food', note: 'نون' });
  assert.equal(d.txns.length, 1);
  assert.equal(d.catMemory['voice:نون'], 'c-food', 'remembered for next time');
  assert.equal(commitVoice(d, { ...st, done: null }), null, 'nothing is recorded without a yes');
});

ok('asks only for what is missing, in order: amount, account, category', () => {
  const d = book();
  let st = talk(d, 'یه چیزی خریدم');
  assert.equal(st.asking, 'amount');
  st = answer(d, T, st, 'سی هزار');
  assert.equal(st.asking, 'account');
  assert.deepEqual(
    st.options.map((o) => o.label),
    ['کیف پول نقد', 'بانک ملت', 'قرض‌الحسنه رسالت'],
  );
  st = answer(d, T, st, 'ملت');
  assert.equal(st.draft.accountId, 'a-mellat');
  assert.equal(st.asking, 'category');
  st = answer(d, T, st, 'بنزین');
  assert.equal(st.draft.categoryId, 'c-transport');
  assert.equal(st.asking, 'confirm');
  assert.match(st.say, /^سی هزار تومان هزینه، دسته حمل‌ونقل، از بانک ملت، امروز/);
  // a tapped option works the same as saying it
  let s2 = talk(d, 'یه چیزی خریدم', 'سی هزار');
  s2 = choose(d, T, s2, 'a-resalat');
  assert.equal(s2.draft.accountId, 'a-resalat');
  s2 = answer(d, T, s2, 'دومی'); // the second category option
  assert.equal(s2.draft.categoryId, d.categories.filter((c) => c.kind === 'expense')[1].id);
});

ok('«پنجاه تومن» is checked: toman, thousand or million', () => {
  const d = book();
  let st = talk(d, 'پنجاه تومن نون خریدم از نقد');
  assert.equal(st.asking, 'scale');
  assert.equal(st.say, 'پنجاه تومان، یا پنجاه هزار تومان؟');
  st = answer(d, T, st, 'هزار');
  assert.equal(st.draft.amountRial, 500_000);
  assert.equal(st.asking, 'confirm');
  const lit = answer(d, T, talk(d, 'پنجاه تومن نون خریدم از نقد'), 'همون پنجاه تومن');
  assert.equal(lit.draft.amountRial, 500);
  assert.equal(choose(d, T, talk(d, 'دو تومن از ملت خرید کردم'), '20000000').draft.amountRial, 20_000_000);
});

ok('transfers: «از … به …» in either order, a card linked from SMS, the only other account', () => {
  const d = book();
  let st = talk(d, 'یک میلیون از ملت به کیف پول نقد منتقل کردم');
  assert.equal(st.asking, 'confirm');
  assert.equal(st.draft.accountId, 'a-mellat');
  assert.equal(st.draft.toAccountId, 'a-cash');
  assert.equal(st.draft.categoryId, null);
  st = talk(d, 'دو میلیون انتقال به رسالت از ملت');
  assert.deepEqual([st.draft.accountId, st.draft.toAccountId], ['a-mellat', 'a-resalat']);
  st = talk(d, 'با کارت ۴۴۱۷ صد هزار تومن دارو خریدم');
  assert.equal(st.draft.accountId, 'a-mellat', 'card 4417 is linked to Mellat');
  assert.equal(st.draft.categoryId, 'c-health');
  assert.equal(st.draft.amountRial, 1_000_000);
  st = talk(d, 'پونصد هزار منتقل کردم از ملت');
  assert.equal(st.asking, 'toAccount');
  assert.deepEqual(
    st.options.map((o) => o.key),
    ['a-cash', 'a-resalat'],
  );
});

ok('corrections at the read-back: «نه، شصت هزار بود», «نه» → what to change, cancel', () => {
  const d = book();
  const base = talk(d, 'سی هزار تومن نون خریدم از نقد');
  let st = answer(d, T, base, 'نه شصت هزار بود');
  assert.equal(st.asking, 'confirm');
  assert.equal(st.draft.amountRial, 600_000);
  st = answer(d, T, base, 'نه');
  assert.equal(st.asking, 'fix');
  st = answer(d, T, st, 'حساب');
  assert.equal(st.asking, 'account');
  st = answer(d, T, st, 'رسالت');
  assert.equal(st.asking, 'confirm');
  assert.match(st.say, /از قرض‌الحسنه رسالت/);
  st = answer(d, T, answer(d, T, base, 'نه'), 'تاریخ');
  assert.equal(st.asking, 'date');
  st = answer(d, T, st, 'پریروز');
  assert.equal(st.draft.date, '2026-10-02');
  assert.equal(st.asking, 'confirm');
  st = answer(d, T, answer(d, T, base, 'نه'), 'تاریخ');
  st = answer(d, T, st, 'دهم');
  assert.equal(st.draft.date, '2026-10-02', '«دهم» alone → this month');
  assert.equal(answer(d, T, base, 'نه دسته اش خرید بود').draft.categoryId, 'c-shop');
  const c = answer(d, T, base, 'بیخیال');
  assert.equal(c.done, 'cancel');
  assert.equal(commitVoice(d, c), null);
  // a future date is refused and asked again
  st = answer(d, T, talk(d, 'یه چیزی خریدم'), 'سی هزار ۲۰ مهر ۱۴۰۵');
  assert.equal(st.asking, 'date');
  assert.match(st.say, /آینده/);
});

ok('the recogniser’s alternatives: the first one that answers the question wins', () => {
  const d = book();
  const st = answer(d, T, talk(d, 'یه چیزی خریدم'), ['سیاه', 'سی هزار']);
  assert.equal(st.draft.amountRial, 300_000);
  const miss = answer(d, T, talk(d, 'یه چیزی خریدم'), ['سیاه']);
  assert.equal(miss.asking, 'amount');
  assert.equal(miss.misses, 1);
  assert.match(miss.say, /^متوجه نشدم/);
  assert.match(answer(d, T, miss, 'گربه').say, /^متوجه نشدم\. مبلغش/, 'not «متوجه نشدم» twice');
});

ok('the book warns about the same amount on the same day; no accounts → nothing to record', () => {
  const d = book();
  d.txns.push({ id: 't1', date: T, kind: 'expense', amountRial: 300_000, accountId: 'a-cash', categoryId: 'c-food' });
  const st = talk(d, 'سی هزار تومن نون خریدم از نقد');
  assert.match(readBack(d, T, st.draft), /یک بار ثبت شده/);
  const empty = emptyData(T);
  empty.accounts = [];
  assert.equal(startVoice(empty, T).done, 'cancel');
});

ok('nothing the user says leaves the device from here (rule 7)', () => {
  for (const f of ['lib/finance/voice.ts', 'lib/voice-io.ts']) {
    if (!fs.existsSync(f)) continue;
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\bfetch\(|\bapi\(|XMLHttpRequest|sendBeacon|WebSocket/, f);
  }
});

console.log(`\nvoice: ${n} checks OK`);
