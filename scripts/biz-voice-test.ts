/**
 * کسب‌وکار من by voice (CLAUDE.md rule 81): a sale and a booking said in one sentence or answered piece by piece,
 * «… انجام شد / لغو»; what is recorded on «بله» and exactly undone by «برگرداندن»; nothing guessed.
 * Run: npx tsx scripts/biz-voice-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { emptyData } from '../lib/finance/model';
import { addBooking, addProduct, setupBusiness } from '../lib/biz/ops';
import { tehranMs, tehranParts } from '../lib/biz/slots';
import { bizAnswer, bizBegin, bizChoose, bizEdit, bizRows, bizStart, commitBiz, dayIn, itemsIn, nameIn, payIn, phoneIn, timeIn, timeWords, undoBiz, type BizUndo, type BizVoiceState } from '../lib/biz/voice';
import { colloquial, speakable } from '../lib/voice-io';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};

const T = '2026-10-04'; // ۱۲ مهر ۱۴۰۵, Sunday
const NOW = tehranMs(T, '12:00');
function shop() {
  const d = emptyData(T);
  setupBusiness(d, { name: 'سالن نارنج', type: 'cafe', card: 'new', now: NOW, today: T });
  const b = d.biz!;
  for (const h of b.hours) Object.assign(h, { open: true, from: '09:00', to: '20:00' });
  addProduct(b, { name: 'لاته', priceRial: 900_000 }, 0);
  addProduct(b, { name: 'کیک شکلاتی', priceRial: 1_200_000 }, 0);
  addProduct(b, { name: 'کیک هویج', priceRial: 1_100_000 }, 0);
  addProduct(b, { name: 'آب معدنی', priceRial: 200_000 }, 0);
  b.services.push({ id: 'cut', name: 'اصلاح مو', durationMin: 30, priceRial: 2_000_000, active: true });
  b.services.push({ id: 'color', name: 'رنگ مو', durationMin: 120, priceRial: 9_000_000, active: true });
  return d;
}
const id = (d: ReturnType<typeof shop>, name: string) => d.biz!.products.find((p) => p.name === name)!.id;
/** say each line in turn, as the assistant would */
function talk(d: ReturnType<typeof shop>, st: BizVoiceState, ...lines: string[]) {
  for (const l of lines) st = bizAnswer(d, st, l, T, NOW);
  return st;
}
const spoken = (s: string) => colloquial(speakable(s));

ok('words: phone, pay, name, day, time', () => {
  assert.equal(phoneIn('شماره ۰۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789');
  assert.equal(phoneIn('۹۱۲۳۴۵۶۷۸۹'), '09123456789');
  assert.equal(phoneIn('صد هزار'), null);
  assert.equal(payIn('کارت کشید'), 'card');
  assert.equal(payIn('نقدی داد'), 'cash');
  assert.equal(payIn('نسیه بنویس'), 'credit');
  assert.equal(payIn('دو تا لاته'), null, 'never assumed');
  assert.equal(nameIn('برای حسن آقا فردا ساعت ده'), 'حسن آقا');
  assert.equal(nameIn('به اسم مریم'), 'مریم');
  assert.equal(dayIn('فردا', T), '2026-10-05');
  assert.equal(dayIn('پس فردا', T), '2026-10-06');
  assert.equal(dayIn('پنجشنبه', T), '2026-10-08');
  assert.equal(dayIn('یکشنبه', T), T, 'today is Sunday');
  assert.equal(dayIn('یکشنبه هفته بعد', T), '2026-10-11');
  assert.equal(dayIn('۲۰ مهر', T), '2026-10-12');
  assert.equal(dayIn('۱۰ مهر', T), '2027-10-02', 'a day already gone is next year');
  assert.equal(timeIn('ساعت پنج و نیم عصر'), '17:30');
  assert.equal(timeIn('ساعت ده و ربع صبح'), '10:15');
  assert.equal(timeIn('ساعت دو و سه ربع'), '14:45');
  assert.equal(timeIn('ساعت ۹'), '09:00', 'eight to twelve without a word stays morning');
  assert.equal(timeIn('ساعت ۵'), '17:00', 'one to seven without a word is afternoon');
  assert.equal(timeIn('ساعت 17:30'), '17:30');
  assert.equal(timeIn('ساعت دوازده ظهر'), '12:00');
  assert.equal(timeIn('هشت شب'), '20:00');
  assert.equal(timeWords('17:30'), 'پنج و نیم عصر');
  assert.equal(timeWords('09:15'), 'نه و ربع صبح');
});

ok('items by the owner’s names: whole name, one distinctive word, an ambiguous word, counts before and after', () => {
  const d = shop();
  const f = itemsIn(d.biz!, 'دو تا لاته و یه کیک شکلاتی و آب معدنی سه تا');
  assert.deepEqual(f.map((x) => [x.item?.name, x.qty]), [['لاته', 2], ['کیک شکلاتی', 1], ['آب معدنی', 3]]);
  const amb = itemsIn(d.biz!, 'یه کیک');
  assert.equal(amb[0].item, null);
  assert.deepEqual(amb[0].candidates.map((x) => x.name).sort(), ['کیک شکلاتی', 'کیک هویج']);
  assert.deepEqual(itemsIn(d.biz!, 'هویج').map((x) => x.item?.name), ['کیک هویج']);
});

ok('a sale in one sentence: read back with the total in words, recorded only on «بله», undone exactly', () => {
  const d = shop();
  const st = bizStart(d, 'دو تا لاته و یه کیک شکلاتی فروختم، نقد', T, NOW)!;
  assert.equal(st.asking, 'confirm');
  assert.equal(st.say, 'دو تا لاته و یک کیک شکلاتی، جمعاً سیصد هزار تومان، نقد. ثبت کنم؟');
  assert.match(spoken(st.say), /سیصد هزار تومن/);
  assert.deepEqual(bizRows(d, st, T).map((r) => r.value), ['لاته×۲، کیک شکلاتی×۱', '۳۰۰٬۰۰۰ تومان', 'نقد']);
  assert.equal(d.biz!.orders.length, 0, 'nothing before «بله»');
  const no = bizAnswer(d, st, 'نه', T, NOW);
  assert.equal(no.asking, 'fix');
  const yes = bizAnswer(d, st, 'آره ثبت کن', T, NOW);
  assert.equal(yes.done, 'save');
  const u = commitBiz(d, yes, NOW) as BizUndo;
  assert.equal(u.kind, 'sale');
  const o = d.biz!.orders[0];
  assert.deepEqual([o.status, o.pay, o.channel, o.totalRial], ['delivered', 'cash', 'walkin', 3_000_000]);
  const row = d.txns.find((t) => t.link?.type === 'biz');
  assert.equal(row?.amountRial, 3_000_000, 'the day’s sales row in the till');
  undoBiz(d, u, NOW);
  assert.equal(d.biz!.orders[0].status, 'canceled');
  assert.equal(d.txns.filter((t) => t.link?.type === 'biz').length, 0, 'the day row goes with it');
});

ok('a sale piece by piece: ambiguous word → «کدوم؟», missing payment asked, never assumed', () => {
  const d = shop();
  let st = bizStart(d, 'سه تا لاته و یه کیک فروختم', T, NOW)!;
  assert.equal(st.asking, 'pick');
  assert.match(st.say, /^کدوم «کیک»؟/);
  st = talk(d, st, 'هویج');
  assert.equal(st.asking, 'pay', 'the payment is asked, not assumed');
  assert.deepEqual(st.options.map((o) => o.key), ['cash', 'card', 'credit']);
  st = bizChoose(d, st, 'card', T, NOW);
  assert.equal(st.asking, 'confirm');
  assert.match(st.say, /^سه تا لاته و یک کیک هویج، جمعاً سیصد و هشتاد هزار تومان، کارت\./);
  // «نه، لاته دو تا باشه» → change, read back again
  st = talk(d, st, 'یه آب معدنی هم اضافه کن');
  assert.match(st.say, /آب معدنی/);
  st = bizAnswer(d, st, 'بله', T, NOW);
  const u = commitBiz(d, st, NOW) as BizUndo;
  assert.equal(typeof u, 'object');
  assert.equal(d.biz!.orders[0].pay, 'card');
});

ok('credit sale: «نسیه به اسم کی؟», an existing debtor is found by name', () => {
  const d = shop();
  let st = bizStart(d, 'یه لاته فروختم نسیه', T, NOW)!;
  assert.equal(st.asking, 'credit');
  st = talk(d, st, 'علی رضایی');
  assert.equal(st.asking, 'confirm');
  assert.match(st.say, /برای علی رضایی/);
  st = talk(d, st, 'بله');
  commitBiz(d, st, NOW);
  assert.equal(d.biz!.credit.length, 1);
  assert.equal(d.biz!.credit[0].name, 'علی رضایی');
  // the second time, the same debtor
  let st2 = bizStart(d, 'دو تا آب معدنی فروختم نسیه برای علی', T, NOW)!;
  assert.equal(st2.draft.kind === 'sale' && st2.draft.creditId, d.biz!.credit[0].id);
  st2 = talk(d, st2, 'بله');
  commitBiz(d, st2, NOW);
  assert.equal(d.biz!.credit.length, 1);
});

ok('what is not a sale: a question, a personal purchase, no product named', () => {
  const d = shop();
  assert.equal(bizStart(d, 'امروز چند تا لاته فروختم؟', T, NOW), null);
  assert.equal(bizStart(d, 'فروش امروز چقدر بود', T, NOW), null);
  assert.equal(bizStart(d, 'پنجاه هزار تومن نون خریدم', T, NOW), null);
  assert.equal(bizStart(d, 'ماشینمو فروختم', T, NOW), null);
  assert.equal(bizStart(emptyData(T), 'دو تا لاته فروختم نقد', T, NOW), null, 'no business, no sale');
});

ok('cancel words and «بیخیال» end it with nothing recorded', () => {
  const d = shop();
  const st = talk(d, bizStart(d, 'دو تا لاته فروختم', T, NOW)!, 'بیخیال');
  assert.equal(st.done, 'cancel');
  assert.equal(typeof commitBiz(d, st, NOW), 'string');
  assert.equal(d.biz!.orders.length, 0);
});

ok('a booking in one sentence; no number is allowed for a booking taken in the shop', () => {
  const d = shop();
  let st = bizStart(d, 'برای سارا فردا ساعت پنج و نیم عصر اصلاح مو نوبت بذار', T, NOW)!;
  assert.equal(st.asking, 'phone');
  st = talk(d, st, 'نداره');
  assert.equal(st.asking, 'confirm');
  assert.equal(st.say, 'نوبت اصلاح مو برای سارا، فردا ساعت پنج و نیم عصر، سی دقیقه، دویست هزار تومان. ثبت کنم؟');
  st = talk(d, st, 'بله');
  const u = commitBiz(d, st, NOW) as BizUndo;
  const bk = d.biz!.bookings[0];
  assert.deepEqual([bk.customerName, bk.customerPhone, tehranParts(bk.startsAt).date, tehranParts(bk.startsAt).time, bk.source, bk.status], ['سارا', '', '2026-10-05', '17:30', 'manual', 'confirmed']);
  undoBiz(d, u, NOW);
  assert.equal(d.biz!.bookings.length, 0);
});

ok('a booking asked piece by piece: service → day (only days with room) → time → name → phone', () => {
  const d = shop();
  let st = bizBegin(d, 'book', T, NOW);
  assert.equal(st.asking, 'service');
  st = bizChoose(d, st, 'color', T, NOW);
  assert.equal(st.asking, 'day');
  assert.equal(st.options[0].label, 'امروز');
  st = talk(d, st, 'پنجشنبه');
  assert.equal(st.asking, 'time');
  assert.match(st.say, /اولین وقت خالی پنجشنبه ۱۶ مهر ساعت نه صبحه/);
  st = talk(d, st, 'ساعت ده');
  assert.equal(st.asking, 'name');
  st = talk(d, st, 'مینا کریمی');
  assert.equal(st.asking, 'phone');
  st = talk(d, st, '۰۹۱۲ ۱۱۱ ۲۲۳۳');
  assert.equal(st.asking, 'confirm');
  st = talk(d, st, 'آره');
  commitBiz(d, st, NOW);
  assert.equal(d.biz!.bookings[0].customerPhone, '09121112233');
});

ok('a taken, closed or past time is not booked: the nearest free before and after are offered', () => {
  const d = shop();
  addBooking(d.biz!, { serviceIds: ['color'], customerName: 'مینا', customerPhone: '09121111111', startsAt: tehranMs('2026-10-05', '10:00'), source: 'manual' }, 0);
  const st = bizStart(d, 'برای سارا فردا ساعت ده و نیم اصلاح مو نوبت بذار', T, NOW)!;
  assert.equal(st.asking, 'time');
  assert.equal(st.say, 'ساعت ده و نیم صبح پره. نزدیک‌ترین وقت خالی: نه و نیم صبح یا دوازده ظهر.');
  assert.deepEqual(st.options.slice(0, 2).map((o) => o.key), ['09:00', '09:15']);
  const closed = bizStart(d, 'برای سارا فردا ساعت ده شب اصلاح مو نوبت بذار', T, NOW)!;
  assert.match(closed.say, /بیرون از ساعت کاریه/);
  const past = bizStart(d, 'برای سارا امروز ساعت ده صبح اصلاح مو نوبت بذار', T, NOW)!;
  assert.match(past.say, /گذشته/);
  // and a booking is never recorded on top of another (the book refuses even if the dialog were bypassed)
  const forced: BizVoiceState = { ...st, draft: { ...(st.draft as any), time: '10:30', customerName: 'سارا', noPhone: true }, asking: 'confirm', done: 'save' };
  assert.equal(commitBiz(d, forced, NOW), 'این زمان با نوبت دیگری تداخل دارد.');
});

ok('«نوبت … انجام شد، کارت»: the service is sold; «برگرداندن» reopens it and cancels the sale', () => {
  const d = shop();
  addBooking(d.biz!, { serviceIds: ['cut'], customerName: 'سارا', customerPhone: '', startsAt: tehranMs(T, '17:00'), source: 'manual' }, 0);
  addBooking(d.biz!, { serviceIds: ['cut'], customerName: 'نیما', customerPhone: '', startsAt: tehranMs(T, '18:00'), source: 'manual' }, 0);
  let st = bizStart(d, 'نوبت سارا انجام شد کارت کشید', T, NOW)!;
  assert.equal(st.asking, 'confirm');
  assert.equal(st.say, 'نوبت سارا ساعت پنج عصر، اصلاح مو، دویست هزار تومان کارت، انجام شد. ثبت کنم؟');
  st = talk(d, st, 'بله');
  const u = commitBiz(d, st, NOW) as BizUndo;
  const bk = d.biz!.bookings.find((x) => x.customerName === 'سارا')!;
  assert.equal(bk.status, 'done');
  const o = d.biz!.orders.find((x) => x.id === bk.orderId)!;
  assert.deepEqual([o.channel, o.pay, o.totalRial], ['booking', 'card', 2_000_000]);
  undoBiz(d, u, NOW);
  assert.equal(bk.status, 'confirmed');
  assert.equal(o.status, 'canceled');
  // which one? → asked with today's open bookings; the payment is asked, not assumed
  let w = bizStart(d, 'نوبت انجام شد', T, NOW)!;
  assert.equal(w.asking, 'which');
  assert.equal(w.options.length, 2);
  w = talk(d, w, 'نیما');
  assert.equal(w.asking, 'pay');
  w = bizChoose(d, w, 'cash', T, NOW);
  assert.equal(w.asking, 'confirm');
});

ok('«نوبت ساعت شش رو لغو کن»; a time that matches nothing lists the day’s bookings; none → it says so', () => {
  const d = shop();
  addBooking(d.biz!, { serviceIds: ['cut'], customerName: 'نیما', customerPhone: '', startsAt: tehranMs(T, '18:00'), source: 'manual' }, 0);
  let st = bizStart(d, 'نوبت ساعت شش رو لغو کن', T, NOW)!;
  assert.equal(st.say, 'نوبت نیما ساعت شش عصر لغو بشه؟');
  st = talk(d, st, 'آره');
  const u = commitBiz(d, st, NOW) as BizUndo;
  assert.equal(d.biz!.bookings[0].status, 'canceled');
  undoBiz(d, u, NOW);
  assert.equal(d.biz!.bookings[0].status, 'confirmed');
  const miss = bizStart(d, 'نوبت ساعت سه رو لغو کن', T, NOW)!;
  assert.equal(miss.asking, 'which');
  assert.match(miss.say, /^نوبتی با این مشخصات پیدا نکردم/);
  const none = bizStart(shop(), 'نوبت ساعت سه رو کنسل کن', T, NOW)!;
  assert.equal(none.done, 'cancel');
  assert.equal(none.say, 'امروز نوبت بازی نیست.');
});

ok('fixing one part: a tapped row asks for it again', () => {
  const d = shop();
  let st = bizStart(d, 'برای سارا فردا ساعت پنج اصلاح مو نوبت بذار', T, NOW)!;
  st = talk(d, st, 'نداره');
  st = bizEdit(d, st, 'time', T, NOW);
  assert.equal(st.asking, 'time');
  st = talk(d, st, 'ساعت شش');
  assert.equal(st.asking, 'confirm');
  assert.match(st.say, /فردا ساعت شش عصر/);
  // a sale: «نه» → «روش پرداخت»
  let s = bizStart(d, 'یه لاته فروختم نقد', T, NOW)!;
  s = bizChoose(d, s, 'no', T, NOW);
  s = bizChoose(d, s, 'pay', T, NOW);
  assert.equal(s.asking, 'pay');
});

ok('nothing here goes to the network (rule 7)', () => {
  assert.doesNotMatch(fs.readFileSync('lib/biz/voice.ts', 'utf8'), /\bfetch\(|\bapi\(|XMLHttpRequest|sendBeacon|WebSocket/);
});

console.log(`\nbiz voice: ${n} checks OK`);
