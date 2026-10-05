// The assistant's questions: «قیمت دلار الان چنده؟», «نمودار سه ماه گذشته طلای ۱۸ عیار»,
// «این ماه چقدر خرج کردم؟», «موجودی حساب ملت». Pure: text in → what was asked → the answer as text to
// show and Persian words to speak. Prices come from the board already on the device (with the date of
// a last price when the market is closed — CLAUDE.md rule 54); a chart is a request the screen fetches
// from /api/chart (only the asset and range leave the device); everything about the user's own book is
// computed here, on the device (rule 7).
import { dailyProfit, lowStock, sumRows } from '@/lib/biz/reports';
import { creditBalance } from '@/lib/biz/ops';
import { tehranParts } from '@/lib/biz/slots';
import { openChecks } from '../finance/balance';
import { accountBalances, monthBounds, monthLabel, monthOf, netWorth, shiftMonth, totalsBetween, addDays, type PriceItem } from '../finance/calc';
import { isMoneyAccount, type FinanceData, type Iso } from '../finance/model';
import { accountHits, amountIn, amountWords, categoryIn, clean, dateWords, kindIn, numberValue, numToWords, tokens } from '../finance/voice';
import { isoToJalali, jalaliToIso } from '../jalali';

export type ChartTf = '1d' | '1w' | '1m' | '3m' | '6m' | '1y';
const TF_DAYS: [ChartTf, number][] = [
  ['1d', 1],
  ['1w', 7],
  ['1m', 30],
  ['3m', 90],
  ['6m', 180],
  ['1y', 365],
];
const TF_WORDS: Record<ChartTf, string> = { '1d': 'امروز', '1w': 'یک هفته گذشته', '1m': 'یک ماه گذشته', '3m': 'سه ماه گذشته', '6m': 'شش ماه گذشته', '1y': 'یک سال گذشته' };

export interface AssetInfo {
  key: string;
  label: string;
  /** how the assistant says it (numbers in words: «هجده») */
  spoken: string;
  /** on /api/chart */
  chart: boolean;
}
// longest / most specific first: «انس طلا» is not «طلا», «نیم سکه» is not «سکه», «شاخص دلار» is not «دلار»
const ASSETS: [RegExp, AssetInfo][] = [
  [/(^| )(dxy|شاخص دلار|قدرت دلار)/, { key: 'dxy', label: 'شاخص دلار (DXY)', spoken: 'شاخص قدرت دلار', chart: false }],
  [/(^| )نیم ?سکه/, { key: 'nim', label: 'نیم سکه', spoken: 'نیم سکه', chart: true }],
  [/(^| )ربع ?سکه/, { key: 'rob', label: 'ربع سکه', spoken: 'ربع سکه', chart: true }],
  [/(^| )(انس|اونس) (جهانی )?نقره/, { key: 'silverOns', label: 'انس جهانی نقره', spoken: 'انس جهانی نقره', chart: true }],
  [/(^| )(انس|اونس)/, { key: 'ons', label: 'انس جهانی طلا', spoken: 'انس جهانی طلا', chart: true }],
  [/(^| )نقره/, { key: 'silver', label: 'نقره ۹۹۹ (هر گرم)', spoken: 'هر گرم نقره', chart: true }],
  [/(^| )سکه/, { key: 'coin', label: 'سکه امامی', spoken: 'سکه امامی', chart: true }],
  [/(^| )طلا/, { key: 'g18', label: 'طلای ۱۸ عیار (هر گرم)', spoken: 'هر گرم طلای هجده عیار', chart: true }],
  [/(^| )(تتر|usdt)( |$)/, { key: 'usdt', label: 'تتر', spoken: 'تتر', chart: true }],
  [/(^| )(بیت ?کوین|بیتکوین|bitcoin|btc)( |$)/, { key: 'btc', label: 'بیت‌کوین', spoken: 'بیت کوین', chart: true }],
  [/(^| )(اتریوم|اتر|ethereum|eth)( |$)/, { key: 'eth', label: 'اتریوم', spoken: 'اتریوم', chart: true }],
  [/(^| )دلار/, { key: 'usd', label: 'دلار آزاد', spoken: 'دلار آزاد', chart: true }],
  [/(^| )(بورس|شاخص)/, { key: 'tse', label: 'شاخص کل بورس', spoken: 'شاخص کل بورس', chart: true }],
  [/(^| )(نفت|برنت)/, { key: 'oilBrent', label: 'نفت برنت', spoken: 'نفت برنت', chart: false }],
];
export function assetIn(text: string): AssetInfo | null {
  const c = clean(text);
  return ASSETS.find(([rx]) => rx.test(c))?.[1] ?? null;
}

export type Question =
  | { type: 'price'; asset: AssetInfo }
  | { type: 'chart'; asset: AssetInfo; tf: ChartTf }
  | { type: 'balance'; accountId: string | null }
  | { type: 'flow'; what: 'expense' | 'income'; from: Iso; to: Iso; period: string; categoryId: string | null }
  | { type: 'networth' }
  | { type: 'help' }
  | { type: 'need-asset' }
  | { type: 'biz'; what: 'sales' | 'profit' | 'pending' | 'bookings' | 'stock' | 'credit'; from: Iso; to: Iso; period: string };

const ASKING = /(^| )(چند|چنده|چنده؟|چقدر|چقدره|چه قدر|چطوره|چطور|کدومه|بگو|بگید|بفرما|نشون|نشان|نشونم|ببینم|میخوام|می خوام|قیمت|نرخ|موجودی|مانده)( |$)/;
const CHART = /(^| )(نمودار|چارت|گراف|روند)/;
const MOVE = /(بالا|پایین|گرون|ارزون|گران|ارزان|تغییر|رشد|افت|ریخت)/;
const HELP = /^(کمک|راهنما|help)( |$)|(^| )(چه کار|چیکار|چی کار|چه کمکی|چی بلدی|چی میتونی|چی می تونی|چی می‌تونی)/;

/** «سه ماه گذشته» / «یک سال» / «هفته پیش» → days; null when no period is said. */
export function periodDays(text: string): number | null {
  const c = ` ${clean(text)} `;
  // «سه ماه», «یک ساله», «۶ ماهه», «دو هفته»
  const m = c.match(/ ((?:[^\s]+ و )?[^\s]+ )?(روز|هفته|ماه|سال)(ه)?( |$)/);
  if (m) {
    const unit = { روز: 1, هفته: 7, ماه: 30, سال: 365 }[m[2] as 'روز' | 'هفته' | 'ماه' | 'سال'];
    const n = m[1] ? numberValue(tokens(m[1].trim())) : null;
    return Math.round((n && n.value > 0 ? n.value : 1) * unit);
  }
  if (/ امسال /.test(c)) return 365;
  if (/ امروز /.test(c)) return 1;
  return null;
}
export function tfFor(days: number): ChartTf {
  return (TF_DAYS.find(([, d]) => d >= days) ?? TF_DAYS[TF_DAYS.length - 1])[0];
}

/** The period of «این ماه چقدر خرج کردم» — this Jalali month unless something else is said. */
function flowPeriod(text: string, today: Iso): { from: Iso; to: Iso; period: string } {
  const c = ` ${clean(text)} `;
  if (/ امروز /.test(c)) return { from: today, to: today, period: 'امروز' };
  if (/ دیروز /.test(c)) return { from: addDays(today, -1), to: addDays(today, -1), period: 'دیروز' };
  if (/ (این|همین) هفته /.test(c)) {
    const back = (new Date(`${today}T00:00:00Z`).getUTCDay() + 1) % 7; // the Iranian week starts on Saturday
    return { from: addDays(today, -back), to: today, period: 'این هفته' };
  }
  const lastMonth = c.match(/ ([^\s]+) ماه (پیش|قبل|گذشته) /) ?? c.match(/ ()ماه (پیش|قبل|گذشته) /);
  if (lastMonth && !numberValue(tokens(lastMonth[1] ?? ''))) {
    const m = shiftMonth(monthOf(today), -1);
    const b = monthBounds(m);
    return { ...b, period: monthLabel(m) };
  }
  if (/ امسال /.test(c)) {
    const j = isoToJalali(today);
    return { from: jalaliToIso(j.jy, 1, 1), to: today, period: 'امسال' };
  }
  const days = periodDays(text);
  if (days && !/ (این|همین) ماه /.test(c)) return { from: addDays(today, -(days - 1)), to: today, period: `${numToWords(days)} روز گذشته` };
  const m = monthOf(today);
  return { from: monthBounds(m).from, to: today, period: `این ماه (${monthLabel(m)})` };
}

/**
 * What the user asked, or null when the sentence is not a question this assistant answers (then it is
 * read as a transaction). A sentence with a clear amount AND a verb of paying or receiving is always a
 * transaction: «صد دلار خریدم» is not a question about the dollar.
 */
export function parseQuestion(d: FinanceData, raw: string, today: Iso): Question | null {
  const c = clean(raw);
  const asked = /[?؟]/.test(raw) || ASKING.test(c);
  if (amountIn(tokens(c), true) && kindIn(c)) return null;
  if (HELP.test(c)) return { type: 'help' };
  const asset = assetIn(c);
  const days = periodDays(c);
  if (CHART.test(c)) {
    if (!asset || !asset.chart) return { type: 'need-asset' };
    return { type: 'chart', asset, tf: tfFor(days ?? 30) };
  }
  if (asset && (asked || MOVE.test(c))) {
    // «دلار این سه ماه چقدر بالا رفته» → the chart answers it
    if (days && days > 1 && asset.chart && MOVE.test(c)) return { type: 'chart', asset, tf: tfFor(days) };
    return { type: 'price', asset };
  }
  if (/(^| )(موجودی|مانده|بالانس)|چقدر پول (دارم|تو|توی)/.test(c)) {
    const h = accountHits(d, c);
    return { type: 'balance', accountId: h.length ? h[0].id : null };
  }
  if (/(^| )(دارایی خالص|کل دارایی|کل داراییم|ثروت|دارایی هام|داراییم)/.test(c)) return { type: 'networth' };
  // کسب‌وکار من (lib/biz): asked about the shop, not the person
  if (d.biz) {
    const shop = /(^| )(مغازه|کسب ?و ?کار|کسب‌وکار|فروشگاه|کافه|سالن|آرایشگاه|کارگاه)/.test(c);
    const what: Extract<Question, { type: 'biz' }>['what'] | null = /(^| )(نوبت|نوبتا|نوبت‌ها|نوبتهای|رزرو)/.test(c)
      ? 'bookings'
      : /(^| )سفارش/.test(c) && /(انتظار|تأیید|تایید|جدید|تازه|چند)/.test(c)
        ? 'pending'
        : /(^| )(انبار|موجودی انبار|تموم|تمام شده|کم داریم|کمه)/.test(c) && (shop || /(^| )(انبار|تموم|کم داریم)/.test(c))
          ? 'stock'
          : /(^| )(نسیه|طلب از مشتری|طلبم از مشتری)/.test(c)
            ? 'credit'
            : /(^| )(سود|سودم)/.test(c) && (shop || asked)
              ? 'profit'
              : /(^| )(فروش|فروشم|فروختم|فروختیم|دخل)/.test(c) && (shop || asked || /(^| )(امروز|دیروز|این)/.test(c))
                ? 'sales'
                : null;
    if (what) {
      if (what === 'bookings') {
        const day = / فردا /.test(` ${c} `) ? addDays(today, 1) : today;
        return { type: 'biz', what, from: day, to: day, period: day === today ? 'امروز' : 'فردا' };
      }
      return { type: 'biz', what, ...flowPeriod(c, today) };
    }
  }
  const spend = /(^| )(خرج|هزینه|خرید|پرداخت)/.test(c);
  const earn = /(^| )(درآمد|درامد|دریافتی|حقوق|دخل)/.test(c);
  if ((spend || earn) && (asked || /(^| )(کردم|کردیم|داشتم|شد)( |$)/.test(c))) {
    const what = spend && !/(^| )(درآمد|درامد|دریافتی)/.test(c) ? 'expense' : 'income';
    const categoryId = categoryIn(d, c.replace(/(^| )(خرج|هزینه|درآمد|درامد|دریافتی)( |$)/g, ' '), what, '');
    return { type: 'flow', what, categoryId, ...flowPeriod(c, today) };
  }
  return null;
}

// ── answers ────────────────────────────────────────────────────────────────

export interface Reply {
  /** shown in the chat */
  text: string;
  /** said aloud: numbers in words */
  speech: string;
  /** the screen fetches /api/chart and draws it, then says `chartSummary` */
  chart?: { asset: string; tf: ChartTf; label: string; spoken: string; unit: 'toman' | 'usd' | 'point' };
  link?: { href: string; label: string };
}

const fa = (n: number, digits = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const UNIT_FA: Record<'toman' | 'usd' | 'point', string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
const digitsFor = (v: number, unit: string) => (unit === 'toman' ? 0 : v >= 100 ? 0 : 2);

/** 1.24 → «یک و دو دهم درصد» (one decimal, as people say it). */
export function pctWords(p: number): string {
  // «چهل و هشت درصد», not «چهل و هشت و چهار دهم»: a tenth matters only for small moves
  const a = Math.abs(p) >= 10 ? Math.round(Math.abs(p)) : Math.round(Math.abs(p) * 10) / 10;
  const int = Math.floor(a);
  const dec = Math.round((a - int) * 10);
  const parts = [int ? numToWords(int) : '', dec ? `${numToWords(dec)} دهم` : ''].filter(Boolean);
  return `${parts.length ? parts.join(' و ') : 'صفر'} درصد`;
}
/** A price said aloud: to the thousand from a million up («بیست و شش میلیون و سیصد و بیست و هشت هزار»), as people say it. */
export const spokenAmount = (v: number) => numToWords(Math.abs(v) >= 1e6 ? Math.round(v / 1000) * 1000 : Math.abs(v) >= 100 ? Math.round(v) : v);
const pctFa = (p: number) => `${fa(Math.abs(p), 1)}٪`;

export const HELP_TEXT =
  'می‌توانید تراکنش ثبت کنید («پنجاه هزار تومن نون خریدم از کیف پول») یا بپرسید: «قیمت دلار چنده؟»، «نمودار سه ماه گذشته طلای ۱۸ عیار»، «این ماه چقدر خرج کردم؟»، «خرج خوراک ماه پیش»، «موجودی حساب ملت»، «دارایی خالصم چقدره؟».';

export function answerQuestion(d: FinanceData, items: PriceItem[], today: Iso, q: Question): Reply {
  switch (q.type) {
    case 'help':
      return { text: HELP_TEXT, speech: 'می‌تونی یه تراکنش بگی تا ثبتش کنم، یا قیمت و نمودار بپرسی، یا بپرسی این ماه چقدر خرج کردی.' };
    case 'need-asset':
      return { text: 'نمودار کدام را نشان بدهم؟ مثلاً «نمودار سه ماه گذشته طلای ۱۸ عیار» یا «نمودار یک ساله دلار».', speech: 'نمودار کدوم رو نشونت بدم؟ مثلاً طلا، دلار یا سکه.' };
    case 'chart': {
      const unit = items.find((i) => i.key === q.asset.key)?.unit ?? (['ons', 'silverOns', 'btc', 'eth'].includes(q.asset.key) ? 'usd' : q.asset.key === 'tse' ? 'point' : 'toman');
      return {
        text: `نمودار ${q.asset.label} — ${TF_WORDS[q.tf]}:`,
        speech: '',
        chart: { asset: q.asset.key, tf: q.tf, label: q.asset.label, spoken: q.asset.spoken, unit },
        link: { href: `/charts?asset=${q.asset.key}&tf=${q.tf}`, label: 'باز کردن در صفحه نمودار' },
      };
    }
    case 'price': {
      const it = items.find((i) => i.key === q.asset.key);
      if (!it || it.price == null) return { text: `قیمت ${q.asset.label} الان در دسترس نیست (داده تازه نرسیده). کمی بعد دوباره بپرسید.`, speech: `الان قیمت ${q.asset.spoken} رو ندارم؛ یه کم بعد دوباره بپرس.` };
      const unitFa = UNIT_FA[it.unit];
      const usdt = items.find((i) => i.key === 'usdt')?.price;
      const inToman = it.unit === 'usd' && ['btc', 'eth'].includes(it.key) && usdt ? it.price * usdt : null;
      const ch = (it as PriceItem & { changePct?: number | null }).changePct;
      const when = it.asOf ? `آخرین قیمت ثبت‌شده، ${dateWords(it.asOf, today)}` : null;
      const text =
        `${q.asset.label}: ${fa(it.price, digitsFor(it.price, it.unit))} ${unitFa}` +
        (inToman ? ` (حدود ${fa(Math.round(inToman))} تومان)` : '') +
        (ch != null && Number.isFinite(ch) && !when ? (Math.abs(ch) < 0.05 ? '؛ امروز بدون تغییر' : `؛ امروز ${pctFa(ch)} ${ch >= 0 ? 'بالا' : 'پایین'}`) : '') +
        (when ? ` — ${when}؛ بازار بسته است یا داده تازه نرسیده.` : '.');
      // said the way people say it: «دلار الان دویست و شصت و هشت هزار تومنه؛ امروز یک و دو دهم درصد رفته بالا»
      const speech =
        (when
          ? `بازار بسته‌ست؛ آخرین قیمت ${q.asset.spoken}، ${dateWords(it.asOf!, today)}، ${spokenAmount(it.price)} ${unitFa} بود`
          : `${q.asset.spoken} الان ${spokenAmount(it.price)} ${unitFa} است`) +
        (inToman ? `؛ یعنی حدود ${spokenAmount(Math.round(inToman / 1000) * 1000)} تومان` : '') +
        (ch != null && Number.isFinite(ch) && !when ? (Math.abs(ch) < 0.05 ? '؛ امروز تغییری نکرده' : `؛ امروز ${pctWords(ch)} ${ch >= 0 ? 'رفته بالا' : 'اومده پایین'}`) : '') +
        '.';
      return { text, speech, link: q.asset.chart ? { href: `/charts?asset=${q.asset.key}&tf=1m`, label: 'نمودار' } : undefined };
    }
    case 'balance': {
      const bal = accountBalances(d);
      const live = d.accounts.filter(isMoneyAccount);
      if (q.accountId) {
        const a = live.find((x) => x.id === q.accountId)!;
        const r = bal[a.id] ?? 0;
        return {
          // the bank's latest balance is the basis (rule 76); a mismatch with the book is said, not hidden
          text:
            `موجودی ${a.name}: ${fa(r / 10)} تومان${a.reported ? ` (بر پایه مانده‌ای که بانک ${dateWords(a.reported.date, today)} گفت)` : ' (طبق دفتر)'}.` +
            (() => {
              const c = openChecks(d).find((x) => x.accountId === a.id);
              return c ? ` با دفتر ${fa(Math.abs(c.diffRial) / 10)} تومان اختلاف دارد؛ در صفحه حساب‌ها بگویید چرا.` : '';
            })(),
          speech: `موجودی ${a.name} ${r < 0 ? 'منفی ' : ''}${amountWords(Math.abs(Math.round(r / 10) * 10))} است.`,
          link: { href: '/accounts', label: 'حساب‌ها' },
        };
      }
      const total = live.reduce((s, a) => s + (bal[a.id] ?? 0), 0);
      const rows = live
        .map((a) => ({ a, r: bal[a.id] ?? 0 }))
        .sort((x, y) => y.r - x.r)
        .slice(0, 4);
      return {
        text: `جمع موجودی حساب‌ها: ${fa(total / 10)} تومان. ${rows.map(({ a, r }) => `${a.name}: ${fa(r / 10)}`).join('، ')}.`,
        speech: `روی هم ${total < 0 ? 'منفی ' : ''}${amountWords(Math.abs(Math.round(total / 10) * 10))} توی حساب‌هات داری.`,
        link: { href: '/accounts', label: 'حساب‌ها' },
      };
    }
    case 'networth': {
      const nw = netWorth(d, items, today);
      const extra = nw.lastPriced.length ? ` (${nw.lastPriced.map((x) => x.name).join('، ')} با آخرین قیمت ثبت‌شده)` : '';
      return {
        text: `دارایی خالص: ${fa(nw.netRial / 10)} تومان — حساب‌ها ${fa(nw.cashRial / 10)}، دارایی بازاری ${fa(nw.marketRial / 10)}، بدهی ${fa(nw.debtRial / 10)}${extra}.`,
        speech: `دارایی خالصت حدود ${nw.netRial < 0 ? 'منفی ' : ''}${amountWords(Math.abs(Math.round(nw.netRial / 1e4) * 1e4))} است.`,
        link: { href: '/', label: 'داشبورد' },
      };
    }
    case 'biz':
      return bizAnswer(d, today, q);
    case 'flow': {
      const t = totalsBetween(d, q.from, q.to);
      const cat = q.categoryId ? d.categories.find((c) => c.id === q.categoryId) : null;
      const rial = cat ? (t.byCategory.find((b) => b.categoryId === cat.id)?.rial ?? 0) : q.what === 'expense' ? t.expenseRial : t.incomeRial;
      const word = q.what === 'expense' ? 'خرج' : 'درآمد';
      const head = `${word}${cat ? ` ${cat.name}` : ''} ${q.period}: ${fa(rial / 10)} تومان`;
      const top =
        !cat && q.what === 'expense' && t.byCategory.length
          ? ` بیشترینش: ${t.byCategory
              .filter((b) => d.categories.find((c) => c.id === b.categoryId)?.kind === 'expense')
              .sort((a, b) => b.rial - a.rial)
              .slice(0, 3)
              .map((b) => `${d.categories.find((c) => c.id === b.categoryId)?.name ?? 'بی‌دسته'} ${fa(b.rial / 10)}`)
              .join('، ')}.`
          : '';
      const income = !cat && q.what === 'expense' && t.incomeRial ? ` درآمد همین مدت: ${fa(t.incomeRial / 10)} تومان.` : '';
      return {
        text: `${head}.${top}${income}`,
        speech: q.what === 'expense' ? `${q.period.replace(/ \(.*\)$/, '')}${cat ? ` برای ${cat.name}` : ''} ${amountWords(Math.round(rial / 10) * 10)} خرج کردی.` : `${q.period.replace(/ \(.*\)$/, '')}${cat ? ` از ${cat.name}` : ''} ${amountWords(Math.round(rial / 10) * 10)} درآمد داشتی.`,
        link: { href: '/transactions', label: 'تراکنش‌ها' },
      };
    }
  }
}

/** The shop's numbers, from the same reports as its pages (lib/biz/reports.ts); all on the device. */
function bizAnswer(d: FinanceData, today: Iso, q: Extract<Question, { type: 'biz' }>): Reply {
  const b = d.biz!;
  const per = q.period.replace(/ \(.*\)$/, '');
  const toman = (rial: number) => `${fa(Math.round(rial / 10))} تومان`;
  const words = (rial: number) => `${rial < 0 ? 'منفی ' : ''}${amountWords(Math.abs(Math.round(rial / 10) * 10))}`;
  switch (q.what) {
    case 'sales':
    case 'profit': {
      const t = sumRows(dailyProfit(b, q.from, q.to));
      if (q.what === 'sales')
        return {
          text: `فروش ${b.name} ${q.period}: ${toman(t.revenueRial)} در ${fa(t.orders)} فاکتور.`,
          speech: `${per} ${b.name} ${words(t.revenueRial)} فروخت${t.orders ? `، ${numToWords(t.orders)} تا فاکتور` : ''}.`,
          link: { href: '/biz/money', label: 'هزینه و سود' },
        };
      return {
        text: `سود ${b.name} ${q.period}: ${toman(t.profitRial)} (فروش ${toman(t.revenueRial)} − بهای تمام‌شده ${toman(t.costRial)} − هزینه‌ها ${toman(t.expensesRial)}).`,
        speech: `سود ${per} ${words(t.profitRial)} بوده.`,
        link: { href: '/biz/money', label: 'هزینه و سود' },
      };
    }
    case 'pending': {
      const p = b.orders.filter((o) => o.status === 'pending');
      return {
        text: p.length ? `${fa(p.length)} سفارش منتظر تأیید است: ${p.slice(0, 5).map((o) => `${o.customerName ?? 'بی‌نام'} (${toman(o.totalRial)})`).join('، ')}.` : 'سفارشی منتظر تأیید نیست.',
        speech: p.length ? `${numToWords(p.length)} تا سفارش منتظر تأییده.` : 'سفارشی منتظر نیست.',
        link: { href: '/biz/orders', label: 'سفارش‌ها' },
      };
    }
    case 'bookings': {
      const list = b.bookings.filter((x) => x.status !== 'canceled' && tehranParts(x.startsAt).date === q.from).sort((x, y) => x.startsAt - y.startsAt);
      const time = (ms: number) => tehranParts(ms).time;
      return {
        text: list.length ? `نوبت‌های ${q.period}: ${list.map((x) => `${time(x.startsAt).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[+c])} ${x.customerName ?? x.customerPhone} (${x.serviceNames.join(' + ')})`).join('، ')}.` : `${q.period} نوبتی ندارید.`,
        speech: list.length ? `${per} ${numToWords(list.length)} تا نوبت داری؛ اولیش ساعت ${numToWords(+time(list[0].startsAt).slice(0, 2))}${+time(list[0].startsAt).slice(3) ? ` و ${numToWords(+time(list[0].startsAt).slice(3))} دقیقه` : ''} است.` : `${per} نوبتی نداری.`,
        link: { href: '/biz/booking', label: 'نوبت‌دهی' },
      };
    }
    case 'stock': {
      const low = lowStock(b);
      return {
        text: low.length ? `به نقطه سفارش رسیده: ${low.map((i) => `${i.name} (${fa(i.stock, 2)} ${i.unit})`).join('، ')}.` : 'هیچ قلمی از انبار به نقطه سفارش نرسیده.',
        speech: low.length ? `${low.slice(0, 3).map((i) => i.name).join('، ')} رو باید سفارش بدی.` : 'انبار فعلاً کم و کسری نداره.',
        link: { href: '/biz/stock', label: 'انبار' },
      };
    }
    case 'credit': {
      const open = b.credit.map((c) => ({ c, r: creditBalance(c) })).filter((x) => x.r > 0).sort((x, y) => y.r - x.r);
      const total = open.reduce((s, x) => s + x.r, 0);
      return {
        text: open.length ? `طلب نسیه: ${toman(total)} — ${open.slice(0, 4).map((x) => `${x.c.name} ${toman(x.r)}`).join('، ')}.` : 'کسی نسیه بدهکار نیست.',
        speech: open.length ? `روی هم ${words(total)} از مشتری‌ها طلب داری.` : 'کسی بهت بدهکار نیست.',
        link: { href: '/biz/customers', label: 'دفتر نسیه' },
      };
    }
  }
}

/** After the chart arrives: what it shows, in a sentence (and in words for speaking). */
export function chartSummary(c: NonNullable<Reply['chart']>, stats: { first: number; last: number; changePct: number; high: number; low: number } | null): { text: string; speech: string } {
  if (!stats) return { text: 'برای این بازه داده کافی نیست.', speech: 'برای این بازه داده‌ی کافی ندارم.' };
  const u = UNIT_FA[c.unit];
  const dg = (v: number) => digitsFor(v, c.unit);
  const up = stats.changePct >= 0;
  return {
    text: `${TF_WORDS[c.tf]}: از ${fa(stats.first, dg(stats.first))} به ${fa(stats.last, dg(stats.last))} ${u} (${pctFa(stats.changePct)} ${up ? 'بالا' : 'پایین'}). بیشترین ${fa(stats.high, dg(stats.high))}، کمترین ${fa(stats.low, dg(stats.low))}.`,
    speech: `${c.spoken} توی ${TF_WORDS[c.tf]} از ${spokenAmount(stats.first)} رسیده به ${spokenAmount(stats.last)} ${u}؛ یعنی ${pctWords(stats.changePct)} ${up ? 'رفته بالا' : 'اومده پایین'}.`,
  };
}
