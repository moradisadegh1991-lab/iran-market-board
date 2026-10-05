/**
 * Pins the assistant's questions (lib/assistant/ask.ts): what is asked (price, chart and its range,
 * balance, spending/income by period and category, net worth), that a transaction being told is never
 * taken for a question, and the answers — the numbers from the board and the book, in words for speaking,
 * the last price's date when the market is closed (rule 54).
 * Run: npx tsx scripts/ask-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { answerQuestion, assetIn, chartSummary, parseQuestion, pctWords, periodDays, tfFor, type Question } from '../lib/assistant/ask';
import type { PriceItem } from '../lib/finance/calc';
import { colloquial, speakable } from '../lib/voice-io';
import { emptyData, type FinanceData } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-04'; // ۱۲ مهر ۱۴۰۵, Sunday

function book(): FinanceData {
  const d = emptyData(T);
  d.accounts.push({ id: 'a-mellat', name: 'بانک ملت', kind: 'bank', openingRial: 50_000_000, openedOn: '2026-01-01', reported: { rial: 48_000_000, date: '2026-10-03', via: 'sms' } });
  d.accounts[0].openingRial = 2_000_000; // cash
  const tx = (id: string, date: string, kind: 'expense' | 'income', toman: number, categoryId: string, accountId = 'a-mellat') =>
    d.txns.push({ id, date, kind, amountRial: toman * 10, accountId, categoryId });
  tx('1', '2026-10-01', 'expense', 350_000, 'c-food', 'a-cash');
  tx('2', '2026-10-03', 'expense', 1_200_000, 'c-transport');
  tx('3', '2026-09-30', 'expense', 900_000, 'c-food'); // ۸ مهر
  tx('4', '2026-09-10', 'expense', 4_000_000, 'c-home'); // ۱۹ شهریور — last month
  tx('5', '2026-09-24', 'income', 30_000_000, 'i-salary'); // ۲ مهر
  tx('6', T, 'expense', 60_000, 'c-food', 'a-cash');
  return d;
}
const items: (PriceItem & { changePct?: number | null })[] = [
  { key: 'usd', price: 102_450, unit: 'toman', changePct: 1.24 },
  { key: 'usdt', price: 103_000, unit: 'toman', changePct: 0.8 },
  { key: 'g18', price: 8_760_000, unit: 'toman', changePct: -0.43 },
  { key: 'coin', price: 98_500_000, unit: 'toman', changePct: 0, asOf: '2026-10-02' },
  { key: 'btc', price: 61_234.5, unit: 'usd', changePct: 2.5 },
];
const q = (s: string) => parseQuestion(book(), s, T);
const say = (s: string) => answerQuestion(book(), items, T, q(s)!);

ok('assets by their everyday names, the specific before the general', () => {
  const k = (s: string) => assetIn(s)?.key ?? null;
  assert.equal(k('قیمت دلار'), 'usd');
  assert.equal(k('طلای ۱۸ عیار'), 'g18');
  assert.equal(k('گرم طلا'), 'g18');
  assert.equal(k('انس طلا'), 'ons');
  assert.equal(k('نیم سکه'), 'nim');
  assert.equal(k('ربع‌سکه'), 'rob');
  assert.equal(k('سکه امامی'), 'coin');
  assert.equal(k('بیت کوین'), 'btc');
  assert.equal(k('بیت‌کوین به دلار'), 'btc');
  assert.equal(k('تتر'), 'usdt');
  assert.equal(k('شاخص بورس'), 'tse');
  assert.equal(k('شاخص دلار'), 'dxy');
  assert.equal(k('نون خریدم'), null);
});

ok('ranges: «سه ماه گذشته» → 3m, «یک سال» → 1y, «دو ماه» → the next range up, none → null', () => {
  assert.equal(periodDays('سه ماه گذشته'), 90);
  assert.equal(periodDays('۳ ماه اخیر'), 90);
  assert.equal(periodDays('یک سال'), 365);
  assert.equal(periodDays('هفته گذشته'), 7);
  assert.equal(periodDays('دلار'), null);
  assert.equal(tfFor(90), '3m');
  assert.equal(tfFor(60), '3m');
  assert.equal(tfFor(7), '1w');
  assert.equal(tfFor(2000), '1y');
});

ok('what was asked', () => {
  const t = (s: string) => {
    const x = q(s);
    return x ? `${x.type}${'asset' in x ? ':' + x.asset.key : ''}${'tf' in x ? ':' + x.tf : ''}` : null;
  };
  assert.equal(t('قیمت دلار الان چنده؟'), 'price:usd');
  assert.equal(t('دلار چند شد'), 'price:usd');
  assert.equal(t('سکه چنده'), 'price:coin');
  assert.equal(t('بیت کوین چقدره'), 'price:btc');
  assert.equal(t('نمودار ۳ ماه گذشته قیمت طلا ۱۸ عیار نشون بده'), 'chart:g18:3m');
  assert.equal(t('نمودار سه ماه گذشته طلای ۱۸ عیار'), 'chart:g18:3m');
  assert.equal(t('روند یک ساله دلار'), 'chart:usd:1y');
  assert.equal(t('نمودار سکه'), 'chart:coin:1m');
  assert.equal(t('دلار این سه ماه چقدر بالا رفته'), 'chart:usd:3m');
  assert.equal(t('نمودار نشون بده'), 'need-asset');
  assert.equal(t('موجودی حساب ملت چقدره'), 'balance');
  assert.equal(t('چه کارهایی میتونی بکنی'), 'help');
  assert.equal(t('دارایی خالصم چقدره'), 'networth');
  assert.equal(t('این ماه چقدر خرج کردم'), 'flow');
  // a transaction being told is never a question
  assert.equal(q('صد دلار خریدم'), null);
  assert.equal(q('صد هزار تومن دلار خریدم'), null);
  assert.equal(q('پنجاه هزار تومن نون خریدم از کیف پول'), null);
  assert.equal(q('سی هزار'), null);
  assert.equal(q('ملت'), null);
  assert.equal(q('بله'), null);
});

ok('price answers: toman with today’s move, BTC in dollars and toman, the closed market’s last price with its day', () => {
  const usd = say('قیمت دلار الان چنده؟');
  assert.equal(usd.text, 'دلار آزاد: ۱۰۲٬۴۵۰ تومان؛ امروز ۱٫۲٪ بالا.');
  assert.equal(usd.speech, 'دلار آزاد الان صد و دو هزار و چهارصد و پنجاه تومان است؛ امروز یک و دو دهم درصد رفته بالا.');
  // what the voice actually gets: spoken Persian, «و» joined to the number before it, «تومنه»
  assert.equal(colloquial(speakable(usd.speech)), 'دلار آزاد الان صدُ دو هزارُ چهارصدُ پنجاه تومنه؛ امروز یکُ دو دهم درصد رفته بالا.');
  const g = say('طلا چند');
  assert.equal(g.speech, 'هر گرم طلای هجده عیار الان هشت میلیون و هفتصد و شصت هزار تومان است؛ امروز چهار دهم درصد اومده پایین.');
  const btc = say('بیت کوین چقدره');
  assert.match(btc.text, /^بیت‌کوین: ۶۱٬۲۳۵ دلار \(حدود ۶٬۳۰۷٬۱۵۳٬۵۰۰ تومان\)/);
  const coin = say('سکه چنده');
  assert.match(coin.text, /آخرین قیمت ثبت‌شده، پریروز؛ بازار بسته است/);
  assert.doesNotMatch(coin.text, /امروز .*٪/, 'no «today» move on a last price');
  const flat = answerQuestion(book(), [{ key: 'usd', price: 100_000, unit: 'toman', changePct: 0.01 } as PriceItem], T, q('دلار چنده')!);
  assert.equal(flat.text, 'دلار آزاد: ۱۰۰٬۰۰۰ تومان؛ امروز بدون تغییر.');
  const none = answerQuestion(book(), items, T, q('نقره چنده')!);
  assert.match(none.text, /در دسترس نیست/);
});

ok('the book: balance of one account or all, spending this month / last month / by category, income, net worth', () => {
  const b = say('موجودی حساب ملت چقدره');
  // 50,000,000 + 30,000,000×10… in rial: opening 50m − 12m − 9m − 40m + 300m = 289m rial
  assert.match(b.text, /^موجودی بانک ملت در دفتر: ۲۸٬۹۰۰٬۰۰۰ تومان \(آخرین مانده‌ای که بانک گفت: ۴٬۸۰۰٬۰۰۰ تومان، دیروز\)/);
  assert.equal(b.speech, 'موجودی بانک ملت بیست و هشت میلیون و نهصد هزار تومان است.');
  assert.equal(colloquial(b.speech), 'موجودی بانک ملت بیستُ هشت میلیونُ نهصد هزار تومنه.');
  assert.match(say('موجودی').text, /^جمع موجودی حساب‌ها: ۲۸٬۶۹۰٬۰۰۰ تومان/);
  // ۱ مهر = 2026-09-23: this month = 1,2,3,6 → 350k + 1.2m + 900k + 60k
  const m = say('این ماه چقدر خرج کردم');
  assert.match(m.text, /^خرج این ماه \(مهر ۱۴۰۵\): ۲٬۵۱۰٬۰۰۰ تومان\. بیشترینش: خوراک ۱٬۳۱۰٬۰۰۰، حمل‌ونقل ۱٬۲۰۰٬۰۰۰\. درآمد همین مدت: ۳۰٬۰۰۰٬۰۰۰ تومان\.$/);
  assert.equal(m.speech, 'این ماه دو میلیون و پانصد و ده هزار تومان خرج کردی.');
  assert.equal(colloquial(m.speech), 'این ماه دو میلیونُ پونصدُ ده هزار تومن خرج کردی.');
  assert.match(say('خرج ماه پیش چقدر بود').text, /^خرج شهریور ۱۴۰۵: ۴٬۰۰۰٬۰۰۰ تومان/);
  assert.match(say('خرج خوراک این ماه چقدره').text, /^خرج خوراک این ماه \(مهر ۱۴۰۵\): ۱٬۳۱۰٬۰۰۰ تومان\.$/);
  assert.match(say('امروز چقدر خرج کردم').text, /^خرج امروز: ۶۰٬۰۰۰ تومان/);
  assert.match(say('این ماه چقدر درآمد داشتم').text, /^درآمد این ماه \(مهر ۱۴۰۵\): ۳۰٬۰۰۰٬۰۰۰ تومان/);
  assert.match(say('دارایی خالصم چقدره').text, /^دارایی خالص: ۲۸٬۶۹۰٬۰۰۰ تومان/);
});

ok('chart: the request names asset and range; the summary reads the real first/last/high/low', () => {
  const r = say('نمودار ۳ ماه گذشته قیمت طلا ۱۸ عیار نشون بده');
  assert.deepEqual(r.chart, { asset: 'g18', tf: '3m', label: 'طلای ۱۸ عیار (هر گرم)', spoken: 'هر گرم طلای هجده عیار', unit: 'toman' });
  assert.equal(r.link?.href, '/charts?asset=g18&tf=3m');
  const s = chartSummary(r.chart!, { first: 8_000_000, last: 8_760_000, changePct: 9.5, high: 8_900_000, low: 7_850_000 });
  assert.equal(s.text, 'سه ماه گذشته: از ۸٬۰۰۰٬۰۰۰ به ۸٬۷۶۰٬۰۰۰ تومان (۹٫۵٪ بالا). بیشترین ۸٬۹۰۰٬۰۰۰، کمترین ۷٬۸۵۰٬۰۰۰.');
  assert.equal(s.speech, 'هر گرم طلای هجده عیار توی سه ماه گذشته از هشت میلیون رسیده به هشت میلیون و هفتصد و شصت هزار تومان؛ یعنی نه و پنج دهم درصد رفته بالا.');
  // «نه» the number is «نُه» (the voice reads a bare «نه» as «na», “no”)
  assert.equal(colloquial(s.speech), 'هر گرم طلای هجده عیار توی سه ماه گذشته از هشت میلیون رسیده به هشت میلیونُ هفتصدُ شصت هزار تومن؛ یعنی نُه وُ پنج دهم درصد رفته بالا.');
  // a big price is said to the thousand, a big move to the whole percent
  const big = chartSummary(r.chart!, { first: 17_740_700, last: 26_327_800, changePct: 48.4, high: 1, low: 1 });
  assert.equal(big.speech, 'هر گرم طلای هجده عیار توی سه ماه گذشته از هفده میلیون و هفتصد و چهل و یک هزار رسیده به بیست و شش میلیون و سیصد و بیست و هشت هزار تومان؛ یعنی چهل و هشت درصد رفته بالا.');
  assert.match(chartSummary(r.chart!, null).text, /داده کافی نیست/);
  assert.equal(pctWords(0.04), 'صفر درصد');
  assert.equal(pctWords(-12.36), 'دوازده درصد', 'a big move: the whole percent');
  assert.equal(pctWords(-2.36), 'دو و چهار دهم درصد');
});

ok('every question type answers without throwing on an empty book and an empty board', () => {
  const d = emptyData(T);
  const all: Question[] = ['قیمت دلار', 'نمودار طلا', 'موجودی', 'این ماه چقدر خرج کردم', 'دارایی خالص', 'کمک', 'نمودار'].map((s) => parseQuestion(d, s, T)!);
  for (const x of all) {
    const r = answerQuestion(d, [], T, x);
    assert.ok(r.text.length > 5, x.type);
  }
});

ok('nothing leaves the device from here (rule 7)', () => {
  assert.doesNotMatch(fs.readFileSync('lib/assistant/ask.ts', 'utf8'), /\bfetch\(|\bapi\(|XMLHttpRequest|sendBeacon|WebSocket/);
});

console.log(`\nask: ${n} checks OK`);
