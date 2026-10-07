// More of the app by voice (rule 85): loans with people («کی بهم بدهکاره؟»), budget («از بودجه خوراک چقدر مونده؟»),
// due dates («قسط بعدیم کیه؟»), goals («هدف خونه چقدر پیش رفته؟»), how the assets did since bought — against the dollar
// and inflation («دارایی‌هام از تورم جلو زدن؟»), a price alert («هر وقت دلار به سیصد هزار رسید خبرم کن») and opening a page
// («بودجه رو باز کن»). Pure and on the device (rule 7); an action (the alert, the page) is only offered — the screen asks
// «بله» before it does it.
import { NAV_GROUPS } from '@/components/nav';
import { budgetStatus, daysBetween, goalPlan, monthOf, netWorth, unitPrice, upcoming, type PriceItem } from '../finance/calc';
import { lendingSummary } from '../finance/lending';
import type { FinanceData, Iso } from '../finance/model';
import { assetPerformance, portfolioPerformance } from '../finance/performance';
import { amountIn, amountWords, clean, dateWords, numToWords, tokens } from '../finance/voice';
import { assetIn, type AssetInfo } from './ask';

export type MoreQ =
  | { type: 'people'; who: string | null; dir: 'owed' | 'owe' | 'both'; business: boolean }
  | { type: 'budget'; categoryId: string | null }
  | { type: 'dues'; days: number; kind: 'all' | 'loan' | 'cheque' | 'bill' | 'income'; next: boolean }
  | { type: 'goals'; goalId: string | null }
  | { type: 'assetsPerf'; assetId: string | null }
  | { type: 'alert'; asset: AssetInfo; dir: 'above' | 'below'; value: number }
  | { type: 'nav'; href: string; label: string };

export interface MoreReply {
  text: string;
  speech: string;
  link?: { href: string; label: string };
  /** offered, done only after «بله» (the screen holds it) */
  action?: { type: 'alert'; asset: string; dir: 'above' | 'below'; value: number; label: string } | { type: 'nav'; href: string; label: string };
}

const fa = (n: number, digits = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const toman = (rial: number) => `${fa(Math.round(rial / 10))} تومان`;
const words = (rial: number) => amountWords(Math.round(Math.abs(rial) / 10) * 10);
const pct = (p: number) => `${p < 0 ? 'منفی ' : ''}${numToWords(Math.round(Math.abs(p)))} درصد`;
const ASKED = /[?؟]|(^| )(چند|چنده|چقدر|چقدره|چه قدر|کی|کیه|کیا|کدوم|کدام|چطور|چطوره|چیه|چی|مونده|مانده|بگو|نشون|نشان)( |$)/;

// pages by the words people use for them (the labels in components/nav.ts, plus everyday names)
const PAGE_ALIAS: [RegExp, string][] = [
  [/(^| )(خونه|خانه|داشبورد)( |$)/, '/'],
  [/(^| )تراکنش/, '/transactions'],
  [/(^| )(حساب|کارت)/, '/accounts'],
  [/(^| )(دارایی)/, '/accounts'],
  [/(^| )(بودجه)/, '/budget'],
  [/(^| )(وام|قسط|چک|قبض|بدهی|قرض)/, '/debts'],
  [/(^| )(صندوق خانگی)/, '/fund'],
  [/(^| )(دنگ)/, '/split'],
  [/(^| )(صندوق فروش|فروش سریع)/, '/biz/pos'],
  [/(^| )(سفارش)/, '/biz/orders'],
  [/(^| )(نوبت)/, '/biz/booking'],
  [/(^| )(انبار)/, '/biz/stock'],
  [/(^| )(نسیه|مشتری)/, '/biz/customers'],
  [/(^| )(اهداف|هدف)/, '/goals'],
  [/(^| )(مشاور)/, '/advisor'],
  [/(^| )(بازار)/, '/market'],
  [/(^| )(نمودار|پیش بینی|پیشبینی)/, '/charts'],
  [/(^| )(هشدار|اعلان)/, '/alerts'],
  [/(^| )(آموزش)/, '/learn'],
  [/(^| )(کسب ?و ?کار|مغازه)/, '/biz'],
];
const OPEN = /(^| )(باز کن|بازش کن|برو به|برو تو|برو|ببرم به|ببر به|نشونم بده صفحه|صفحه)( |$)/;

function navTarget(c: string): { href: string; label: string } | null {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  for (const it of all) if (` ${c} `.includes(` ${clean(it.label)} `)) return { href: it.href, label: it.label };
  for (const [rx, href] of PAGE_ALIAS) if (rx.test(c)) return { href, label: all.find((x) => x.href === href)?.label ?? href };
  return null;
}

export function parseMore(d: FinanceData, raw: string, today: Iso): MoreQ | null {
  const c = clean(raw);
  const asked = ASKED.test(raw) || ASKED.test(c);

  // opening a page: «بودجه رو باز کن», «برو به صندوق فروش»
  if (OPEN.test(c) && !/(قرض|خرید|فروختم|خریدم)/.test(c)) {
    const t = navTarget(c.replace(OPEN, ' '));
    if (t) return { type: 'nav', ...t };
  }

  // a price alert: «هر وقت دلار به سیصد هزار رسید خبرم کن», «اگه طلا زیر هفت میلیون اومد بهم بگو»
  if (/(خبرم کن|خبر بده|بهم بگو|هشدار بذار|هشدار بده|یادم بنداز|اطلاع بده)/.test(c)) {
    const asset = assetIn(c);
    const amt = amountIn(tokens(c), false);
    if (asset && amt) {
      // the amount as said is in the board's own unit for that row: toman, or dollars for the coins and the ounce
      const value = amt.rial / 10;
      const dir = /(زیر|پایین|کمتر|کم شد|ارزون|ارزان|برسه به کمتر)/.test(c) ? 'below' : 'above';
      return { type: 'alert', asset, dir, value };
    }
  }

  // loans with people
  // «نسیه» is the business's credit book (sales on account), not money lent — that question stays with ask.ts
  if (/(بدهکار|طلبکار|طلب|بدهی|قرض)/.test(c) && asked && !/(^| )نسیه/.test(c)) {
    const business = !!d.biz && /(مغازه|کسب ?و ?کار|کسبوکار|فروشگاه)/.test(c);
    const names = d.accounts.filter((a) => a.kind === 'person' && !!a.bizId === business).map((a) => a.name);
    const who = names.find((n) => ` ${c} `.includes(` ${clean(n)} `)) ?? null;
    const owe = /(بدهکارم|به کی بدهکار|بدهی هام|بدهیام|بدهی‌هام|من بدهکار|باید بدم|بدهی من)/.test(c);
    const owed = /(بهم بدهکار|به من بدهکار|طلب|طلبکارم|بدهکاره|بدهکارن|ازش طلب)/.test(c);
    return { type: 'people', who, dir: owe && !owed ? 'owe' : owed && !owe ? 'owed' : 'both', business };
  }

  // budget
  if (/(^| )بودجه/.test(c) && asked) {
    const cat = d.categories.find((x) => x.kind === 'expense' && ` ${c} `.includes(` ${clean(x.name)} `));
    return { type: 'budget', categoryId: cat?.id ?? null };
  }

  // due dates: «قسط بعدی», «چک‌های این ماه», «این هفته چی باید بدم؟»
  if (/(^| )(قسط|اقساط|چک|قبض|سررسید|اجاره)/.test(c) && asked) {
    const kind = /(^| )(قسط|اقساط)/.test(c) ? 'loan' : /(^| )چک/.test(c) ? 'cheque' : /(^| )(قبض|اجاره)/.test(c) ? 'bill' : 'all';
    const days = /(این هفته|هفته)/.test(c) ? 7 : /(دو ماه|۲ ماه)/.test(c) ? 60 : 31;
    return { type: 'dues', days, kind, next: /(بعدی|بعدیم|نزدیک ترین|اولین)/.test(c) };
  }
  if (/(این هفته|این ماه|فردا|امروز).*(چی باید بدم|چی باید پرداخت|پرداخت دارم|چی دارم که بدم)/.test(c)) return { type: 'dues', days: /هفته/.test(c) ? 7 : /فردا|امروز/.test(c) ? 1 : 31, kind: 'all', next: false };

  // goals
  if (/(^| )(هدف|اهداف|هدفم|هدفام)/.test(c) && asked) {
    const g = d.goals.find((x) => ` ${c} `.includes(` ${clean(x.name)} `) || clean(x.name).split(' ').some((w) => w.length > 2 && ` ${c} `.includes(` ${w} `)));
    return { type: 'goals', goalId: g?.id ?? null };
  }

  // assets since bought: against the dollar and inflation
  if ((/(تورم|نسبت به دلار|به دلار|دلاری|از دلار)/.test(c) && /(دارایی|طلا|سکه|دلار|ماشین|خونه|ملک|سرمایه|خرید)/.test(c)) || /(دارایی ?ها?م|داراییام).*(سود|رشد|ضرر|چطور)/.test(c)) {
    const a = d.assets.find((x) => ` ${c} `.includes(` ${clean(x.name)} `));
    return { type: 'assetsPerf', assetId: a?.id ?? null };
  }
  return null;
}

export function answerMore(d: FinanceData, items: PriceItem[], today: Iso, q: MoreQ, now: number): MoreReply {
  switch (q.type) {
    case 'nav':
      return { text: `«${q.label}» را باز کنم؟`, speech: `${q.label} رو باز کنم؟`, action: { type: 'nav', href: q.href, label: q.label } };

    case 'alert': {
      const unit = ['ons', 'silverOns', 'btc', 'eth'].includes(q.asset.key) ? 'دلار' : 'تومان';
      const label = `${q.asset.label} ${q.dir === 'above' ? 'بالاتر از' : 'پایین‌تر از'} ${fa(q.value)} ${unit}`;
      return {
        text: `هشدار بگذارم: ${label}؟ (فقط وقتی اپ باز است بررسی می‌شود.)`,
        speech: `هشدار بذارم برای وقتی ${q.asset.spoken} ${q.dir === 'above' ? 'بالای' : 'زیر'} ${numToWords(Math.round(q.value))} ${unit === 'دلار' ? 'دلار' : 'تومن'} رفت؟`,
        action: { type: 'alert', asset: q.asset.key, dir: q.dir, value: q.value, label },
      };
    }

    case 'people': {
      const s = lendingSummary(d, q.business);
      const link = { href: '/debts', label: 'قرض با اشخاص' };
      const who = q.business ? 'کسب‌وکار' : '';
      if (q.who) {
        const p = [...s.owedToMe, ...s.iOwe].find((x) => x.account.name === q.who);
        const b = p?.balanceRial ?? 0;
        if (!b) return { text: `با ${q.who} حساب صاف است.`, speech: `با ${q.who} بی‌حسابی.`, link };
        return b > 0
          ? { text: `${q.who} ${toman(b)} به ${who || 'شما'} بدهکار است.`, speech: `${q.who} ${words(b)} به ${who || 'تو'} بدهکاره.`, link }
          : { text: `${who || 'شما'} ${toman(-b)} به ${q.who} بدهکار${who ? ' است' : 'ید'}.`, speech: `${who ? 'کسب‌وکار' : ''} ${words(-b)} به ${q.who} بدهکاری.`.trim(), link };
      }
      const list = (rows: typeof s.owedToMe) => rows.slice(0, 5).map((p) => `${p.account.name} ${toman(Math.abs(p.balanceRial))}`).join('، ');
      const parts: string[] = [];
      const spoken: string[] = [];
      if (q.dir !== 'owe') {
        parts.push(s.owedToMe.length ? `طلب ${who || 'شما'}: ${toman(s.owedToMeRial)} — ${list(s.owedToMe)}.` : 'کسی بدهکار نیست.');
        spoken.push(s.owedToMe.length ? `${numToWords(s.owedToMe.length)} نفر روی هم ${words(s.owedToMeRial)} ${who ? 'به کسب‌وکار' : 'بهت'} بدهکارن${s.owedToMe[0] ? `؛ بیشترش ${s.owedToMe[0].account.name}` : ''}.` : 'کسی بهت بدهکار نیست.');
      }
      if (q.dir !== 'owed') {
        parts.push(s.iOwe.length ? `بدهی ${who || 'شما'}: ${toman(s.iOweRial)} — ${list(s.iOwe)}.` : `${who || 'شما'} به کسی بدهکار نیست${who ? '' : 'ید'}.`);
        spoken.push(s.iOwe.length ? `روی هم ${words(s.iOweRial)} به ${numToWords(s.iOwe.length)} نفر بدهکاری.` : 'به کسی بدهکار نیستی.');
      }
      return { text: parts.join(' '), speech: spoken.join(' '), link };
    }

    case 'budget': {
      const lines = budgetStatus(d, monthOf(today), today);
      const link = { href: '/budget', label: 'بودجه' };
      if (!lines.length) return { text: 'هنوز بودجه‌ای تعریف نکرده‌اید.', speech: 'هنوز بودجه‌ای نذاشتی.', link };
      const name = (id: string) => d.categories.find((c) => c.id === id)?.name ?? 'بی‌دسته';
      const pick = q.categoryId ? lines.filter((l) => l.categoryId === q.categoryId) : lines;
      if (!pick.length) return { text: `برای ${name(q.categoryId!)} بودجه‌ای تعریف نشده.`, speech: `برای ${name(q.categoryId!)} بودجه نذاشتی.`, link };
      if (pick.length === 1) {
        const l = pick[0];
        const left = l.limitRial - l.spentRial;
        return {
          text: `بودجه ${name(l.categoryId)} این ماه: ${toman(l.limitRial)}؛ خرج ${toman(l.spentRial)} (${fa(l.usedPct)}٪ در ${fa(l.pacePct)}٪ ماه)؛ ${left >= 0 ? `${toman(left)} مانده` : `${toman(-left)} بیشتر از بودجه`}.`,
          speech: left >= 0 ? `از بودجه ${name(l.categoryId)} ${words(left)} مونده.` : `از بودجه ${name(l.categoryId)} ${words(-left)} بیشتر خرج کردی.`,
          link,
        };
      }
      const limit = pick.reduce((s, l) => s + l.limitRial, 0);
      const spent = pick.reduce((s, l) => s + l.spentRial, 0);
      const hot = pick.filter((l) => l.status !== 'ok');
      return {
        text: `بودجه این ماه: ${toman(limit)}، خرج ${toman(spent)}، مانده ${toman(limit - spent)}.${hot.length ? ` تند یا بیشتر از بودجه: ${hot.map((l) => name(l.categoryId)).join('، ')}.` : ''}`,
        speech: `از کل بودجه این ماه ${words(Math.max(0, limit - spent))} مونده${hot.length ? `؛ ${hot.slice(0, 2).map((l) => name(l.categoryId)).join(' و ')} داره تند جلو می‌ره` : ''}.`,
        link,
      };
    }

    case 'dues': {
      const all = upcoming(d, today, q.days).filter((x) => q.kind === 'all' || x.type === q.kind).sort((a, b) => (a.date < b.date ? -1 : 1));
      const link = { href: '/debts', label: 'وام، چک و قبض' };
      const what = q.kind === 'loan' ? 'قسطی' : q.kind === 'cheque' ? 'چکی' : q.kind === 'bill' ? 'قبض و پرداختی' : 'سررسیدی';
      if (!all.length) return { text: `در ${fa(q.days)} روز آینده ${what} ندارید.`, speech: `تو ${numToWords(q.days)} روز آینده ${what} نداری.`, link };
      if (q.next) {
        const x = all[0];
        return {
          text: `${x.label}: ${toman(Math.abs(x.rial))}، ${dateWords(x.date, today)}${x.overdue ? ' (گذشته!)' : ''}.`,
          speech: `${x.label}، ${words(Math.abs(x.rial))}، ${dateWords(x.date, today)}${x.overdue ? '؛ عقب افتاده' : ''}.`,
          link,
        };
      }
      const out = all.filter((x) => x.rial < 0).reduce((s, x) => s - x.rial, 0);
      return {
        text: `${fa(all.length)} سررسید در ${fa(q.days)} روز آینده (پرداختی ${toman(out)}): ${all
          .slice(0, 6)
          .map((x) => `${x.label} ${toman(Math.abs(x.rial))} ${dateWords(x.date, today)}`)
          .join('، ')}.`,
        speech: `${numToWords(all.length)} تا سررسید داری، روی هم ${words(out)} باید بدی؛ اولیش ${all[0].label}، ${dateWords(all[0].date, today)}.`,
        link,
      };
    }

    case 'goals': {
      const link = { href: '/goals', label: 'اهداف' };
      const gs = q.goalId ? d.goals.filter((g) => g.id === q.goalId) : d.goals;
      if (!gs.length) return { text: 'هنوز هدفی تعریف نکرده‌اید.', speech: 'هنوز هدفی نذاشتی.', link };
      const rows = gs.map((g) => ({ g, p: goalPlan(g, today, d.settings.inflationPct, d.settings.safeYieldPct) }));
      if (rows.length === 1) {
        const { g, p } = rows[0];
        return {
          text: `${g.name}: ${fa(p.progressPct)}٪ (پس‌انداز ${toman(g.savedRial)} از ${toman(p.futureTargetRial)})؛ ${p.reached ? 'رسیدید!' : `${fa(p.monthsLeft)} ماه مانده، ماهی ${toman(p.monthlyAtSafeYieldRial)} لازم است.`}`,
          speech: p.reached ? `به هدف ${g.name} رسیدی.` : `هدف ${g.name} ${pct(p.progressPct)} پیش رفته؛ ماهی ${words(p.monthlyAtSafeYieldRial)} لازمه.`,
          link,
        };
      }
      return {
        text: rows.map(({ g, p }) => `${g.name} ${fa(p.progressPct)}٪`).join('، ') + '.',
        speech: rows
          .slice(0, 3)
          .map(({ g, p }) => `${g.name} ${pct(p.progressPct)}`)
          .join('، '),
        link,
      };
    }

    case 'assetsPerf': {
      const link = { href: '/accounts', label: 'دارایی‌ها' };
      const nw = netWorth(d, items, today);
      const usdNow = unitPrice('usd', items)?.rial ?? null;
      const perfs = d.assets
        .filter((a) => !q.assetId || a.id === q.assetId)
        .map((a) => assetPerformance(a, nw.byAsset.find((x) => x.id === a.id)?.rial ?? null, usdNow, today, d.settings.inflationPct))
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (!perfs.length)
        return { text: 'برای مقایسه با دلار و تورم، تاریخ و مبلغ خرید دارایی‌ها را در «حساب‌ها و کارت‌ها» بنویسید.', speech: 'تاریخ و مبلغ خرید دارایی‌هات رو وارد نکردی؛ اول اونا رو بنویس.', link };
      if (perfs.length === 1) {
        const p = perfs[0];
        const yrs = p.years >= 1 ? `${fa(p.years, 1)} سال` : `${fa(Math.max(1, daysBetween(p.boughtOn, today)))} روز`;
        return {
          text: `${p.name} در ${yrs}: ${fa(p.growthPct, 1)}٪ تومانی${p.usdGrowthPct != null ? `، ${fa(p.usdGrowthPct, 1)}٪ دلاری (دلار ${fa(p.dollarMovePct ?? 0, 0)}٪ رشد کرد)` : ''}${p.realPct != null ? `، بعد از تورم ${fa(p.realPct, 1)}٪` : ''}.`,
          speech: `${p.name} ${pct(p.growthPct)} رشد کرده${p.vsDollar ? `؛ از دلار ${p.vsDollar === 'beat' ? 'جلو زده' : p.vsDollar === 'lost' ? 'عقب مونده' : 'هم‌پا بوده'}` : ''}${p.vsInflation ? ` و از تورم ${p.vsInflation === 'beat' ? 'جلو زده' : p.vsInflation === 'lost' ? 'عقب مونده' : 'هم‌پا بوده'}` : ''}.`,
          link,
        };
      }
      const t = portfolioPerformance(perfs)!;
      return {
        text: `${fa(t.count)} دارایی با تاریخ خرید: ${fa(t.growthPct, 1)}٪ تومانی${t.usdGrowthPct != null ? `، ${fa(t.usdGrowthPct, 1)}٪ دلاری` : ''}${t.realPct != null ? `، بعد از تورم ${fa(t.realPct, 1)}٪` : ''}.`,
        speech: `روی هم ${pct(t.growthPct)} رشد کردن${t.realPct != null ? `؛ بعد از تورم ${pct(t.realPct)}` : ''}${t.usdGrowthPct != null ? `، به دلار ${pct(t.usdGrowthPct)}` : ''}.`,
        link,
      };
    }
  }
}
