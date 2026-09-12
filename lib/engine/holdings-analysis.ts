/**
 * Analysis layer on top of the holdings list:
 *  1. was each lot bought at a good moment? (percentile of the paid price within its own history)
 *  2. hold / sell risk for that asset across the six horizons (reuses the snapshot risk engine)
 *  3. how close the whole portfolio sits to the suggested basket (overlap %)
 *
 * Everything here is derived from data the app already has — no new external source.
 */
import { isNum, tehranDate } from '@/lib/num';
import { maxDrawdown, mean, rsi, std } from '@/lib/engine/stats';
import { buildSeries, loadSeriesInputs } from '@/lib/series';
import type { AssetRisk, HorizonKey, Portfolio, PortfolioHorizon, Profile, RiskAssetKey, Snapshot } from '@/lib/types';
import { INSTRUMENT, type HoldingKind, type ValuedHolding } from '@/lib/holdings';

export const HORIZON_LABEL: Record<HorizonKey, string> = {
  d1: 'روزانه',
  w1: 'هفتگی',
  m1: 'ماهانه',
  m3: '۳ ماهه',
  m6: '۶ ماهه',
  y1: 'سالانه',
};

/** Which risk/price series stands in for each holding instrument. */
const RISK_KEY: Record<string, RiskAssetKey> = {
  g18: 'g18',
  g24: 'g18',
  gmelted: 'g18',
  coin_emami: 'coin',
  coin_bahar: 'coin',
  coin_half: 'coin',
  coin_quarter: 'coin',
  coin_gram: 'coin',
  usd: 'usd',
  eur: 'usd',
  aed: 'usd',
  gbp: 'usd',
  try: 'usd',
  usdt: 'usdt',
  btc: 'btc',
  eth: 'eth',
};

/** Portfolio class each holding maps onto, for comparison with the suggested basket. */
const CLASS_OF: Record<HoldingKind, Portfolio['lines'][number]['cls']> = {
  gold: 'gold',
  coin: 'gold',
  currency: 'usd',
  crypto: 'btc',
};
/** …except these crypto instruments, which are not "BTC/ETH core". */
const SPEC_CRYPTO = new Set(['sol', 'xrp', 'doge', 'ton']);
const CASH_LIKE = new Set(['usdt']);

/** Minimum prior history before we are willing to judge an entry at all. */
const MIN_PRIOR_DAYS = 60;
const ENTRY_WINDOW = 180;

export interface EntryVerdict {
  /** 0..100 — how stretched the price looked at purchase (0 = deeply oversold, 100 = very overextended) */
  overextension: number | null;
  /** 0..100 — where the paid unit price sat in the window up to the purchase (0 = cheapest) */
  pricePercentile: number | null;
  /** return of this asset from the purchase date to now, % */
  sinceBuyPct: number | null;
  /** the asset's own price on the purchase date, for reference */
  priceOnDate: number | null;
  /** how the paid price compares with that day's market price, % (positive = paid above market) */
  premiumPct: number | null;
  grade: 'good' | 'fair' | 'poor' | 'unknown';
  text: string;
}

export interface HoldingAnalysis {
  id: string;
  riskKey: RiskAssetKey | null;
  entry: EntryVerdict;
  /** hold/sell risk per horizon, copied from the snapshot's risk engine */
  horizons: Record<HorizonKey, { hold: number; sell: number; pDown: number; expReturnPct: number; confidence: number } | null> | null;
  annualVolPct: number | null;
  note: string | null;
}

export interface SimilarityClass {
  cls: Portfolio['lines'][number]['cls'];
  label: string;
  mine: number; // 0..1
  suggested: number; // 0..1
  gapPct: number; // signed difference in percentage points
  advice: string;
}

export interface PortfolioMatch {
  profile: Profile;
  horizon: PortfolioHorizon;
  /** 0..100 — overlap of the two weight vectors */
  similarityPct: number;
  classes: SimilarityClass[];
  headline: string;
  /** biggest single correction, if any */
  topFix: string | null;
}

export interface HoldingsAnalysis {
  perHolding: HoldingAnalysis[];
  match: PortfolioMatch | null;
  warnings: string[];
}

/** Percentile of `value` inside `arr` (0 = lowest). */
function percentile(arr: number[], value: number): number | null {
  if (!arr.length) return null;
  let below = 0;
  for (const v of arr) if (v <= value) below++;
  return (below / arr.length) * 100;
}

function entryGrade(over: number | null): EntryVerdict['grade'] {
  if (!isNum(over)) return 'unknown';
  if (over <= 40) return 'good';
  if (over <= 65) return 'fair';
  return 'poor';
}

/**
 * Judge one purchase. `series` is the asset's own daily history (ascending),
 * `paidUnit` the toman actually paid per unit, `boughtOn` a Gregorian YYYY-MM-DD.
 *
 * The percentile is deliberately computed on the 180 days *up to* the purchase date only —
 * using later prices would grade the decision with information the buyer did not have.
 */
export function judgeEntry(
  series: { dates: string[]; prices: number[] } | null,
  boughtOn: string | null,
  paidUnit: number | null,
  livePrice: number | null,
  sameUnit: boolean,
): EntryVerdict {
  const none = (text: string): EntryVerdict => ({ overextension: null, pricePercentile: null, sinceBuyPct: null, priceOnDate: null, premiumPct: null, grade: 'unknown', text });
  if (!boughtOn) return none('برای تحلیل زمان خرید، تاریخ خرید را وارد کنید.');
  if (!series || series.dates.length < 30) return none('تاریخچه کافی برای این دارایی ذخیره نشده است.');

  // last index at or before the purchase date
  let idx = -1;
  for (let i = 0; i < series.dates.length; i++) {
    if (series.dates[i] <= boughtOn) idx = i;
    else break;
  }
  if (idx < 0) return none('تاریخ خرید قدیمی‌تر از تاریخچه موجود است.');

  const priceOnDate = series.prices[idx];
  const last = series.prices[series.prices.length - 1];
  const sinceBuyPct = isNum(priceOnDate) && priceOnDate > 0 && isNum(last) ? (last / priceOnDate - 1) * 100 : null;
  const premiumPct = sameUnit && isNum(paidUnit) && paidUnit > 0 && isNum(priceOnDate) && priceOnDate > 0 ? (paidUnit / priceOnDate - 1) * 100 : null;

  // Only prices strictly up to the purchase date — grading a decision with later
  // prices would be hindsight, not analysis.
  const prior = series.prices.slice(Math.max(0, idx - (ENTRY_WINDOW - 1)), idx + 1);
  if (prior.length < MIN_PRIOR_DAYS) {
    const parts = [`پیش از تاریخ خرید فقط ${faInt(prior.length)} روز داده داریم؛ برای داوری درباره شرایط خرید کافی نیست.`];
    if (isNum(sinceBuyPct)) parts.push(`از آن تاریخ تا امروز این بازار ${signed(sinceBuyPct)} شده است.`);
    return { overextension: null, pricePercentile: null, sinceBuyPct, priceOnDate, premiumPct, grade: 'unknown', text: parts.join(' ') };
  }

  // Same "overextension" measure the risk engine uses for its buy score (RSI + z-score of log
  // price vs its window mean), so a purchase is judged by the yardstick the rest of the app uses.
  // A plain price percentile is not usable here: in a trending market every entry looks expensive.
  const logs = prior.map(Math.log);
  const zsd = std(logs);
  const z = zsd > 0 ? (Math.log(priceOnDate) - mean(logs)) / zsd : 0;
  const zComp = Math.max(-1, Math.min(1, z / 2));
  const rs = rsi(prior, 14);
  const rsiComp = rs === null ? 0 : Math.max(-1, Math.min(1, (rs - 50) / 30));
  const O = 0.4 * rsiComp + 0.6 * zComp; // same blend as the 1–3 month horizons
  const dd = Math.abs(maxDrawdown(prior));
  const overextension = Math.round(Math.max(0, Math.min(100, 100 * ((O + 1) / 2) - 10 * Math.min(1, dd / 0.2))));
  const pricePercentile = percentile(prior, sameUnit && isNum(paidUnit) && paidUnit > 0 ? paidUnit : priceOnDate);
  const grade = entryGrade(overextension);

  const parts: string[] = [];
  parts.push(
    grade === 'good'
      ? `در زمان خرید، قیمت نسبت به میانگین خودش کشیده نبود (شاخص گرانی ${faInt(overextension)} از ۱۰۰)؛ شرایط ورود مناسب بود.`
      : grade === 'fair'
        ? `در زمان خرید، قیمت نه ارزان و نه گران بود (شاخص گرانی ${faInt(overextension)} از ۱۰۰)؛ ورود بی‌اشکال ولی بی‌مزیت بود.`
        : `در زمان خرید، قیمت نسبت به میانگین خودش گران بود (شاخص گرانی ${faInt(overextension)} از ۱۰۰)؛ ورود در نقطه کشیده بازار انجام شده.`,
  );
  if (isNum(rs)) parts.push(`RSI همان روز ${faInt(rs)} بود.`);
  if (isNum(sinceBuyPct)) parts.push(`از آن تاریخ تا امروز این بازار ${signed(sinceBuyPct)} شده است.`);
  if (isNum(premiumPct) && Math.abs(premiumPct) >= 2) {
    parts.push(premiumPct > 0 ? `پرداختی شما ${signed(premiumPct)} بالاتر از قیمت مرجع همان روز بود (اجرت، کارمزد یا اسپرد).` : `پرداختی شما ${signed(premiumPct)} نسبت به قیمت مرجع همان روز بود.`);
  }
  if (!sameUnit) parts.push('مقایسه بر پایه بازار مرجع این دارایی است، نه قیمت دقیق همان قلم.');
  parts.push('این داوری درباره شرایط بازار در آن لحظه است، نه درباره سود یا زیان نهایی.');

  return { overextension, pricePercentile, sinceBuyPct, priceOnDate, premiumPct, grade, text: parts.join(' ') };
}

const faInt = (n: number) => new Intl.NumberFormat('fa-IR').format(Math.round(n));
const signed = (p: number) => `${p >= 0 ? '+' : '−'}${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Math.abs(p))}٪`;

/** Which portfolio class a valued holding belongs to. */
export function classOf(h: ValuedHolding): Portfolio['lines'][number]['cls'] {
  if (CASH_LIKE.has(h.instrument)) return 'cash';
  if (h.kind === 'crypto' && SPEC_CRYPTO.has(h.instrument)) return 'spec';
  return CLASS_OF[h.kind] ?? 'spec';
}

/**
 * Overlap between the user's actual weights and a suggested basket.
 * similarity = 1 − ½·Σ|wᵢ − vᵢ|, the standard overlap of two distributions:
 * 100% means identical, 0% means no shared exposure at all.
 */
export function comparePortfolio(items: ValuedHolding[], portfolio: Portfolio, totalValue: number): PortfolioMatch | null {
  if (!(totalValue > 0)) return null;
  const mine = new Map<string, number>();
  for (const h of items) {
    if (!isNum(h.valueToman)) continue;
    const c = classOf(h);
    mine.set(c, (mine.get(c) ?? 0) + h.valueToman / totalValue);
  }
  const suggested = new Map<string, { w: number; label: string }>();
  for (const l of portfolio.lines) suggested.set(l.cls, { w: l.weight, label: l.label });

  const allCls = [...new Set([...mine.keys(), ...suggested.keys()])] as Portfolio['lines'][number]['cls'][];
  let absDiff = 0;
  const classes: SimilarityClass[] = allCls
    .map((cls) => {
      const m = mine.get(cls) ?? 0;
      const s = suggested.get(cls)?.w ?? 0;
      absDiff += Math.abs(m - s);
      const gapPct = (m - s) * 100;
      const advice =
        Math.abs(gapPct) < 3
          ? 'نزدیک به سبد پیشنهادی'
          : gapPct > 0
            ? `${faInt(Math.abs(gapPct))} واحد درصد بیشتر از پیشنهاد`
            : `${faInt(Math.abs(gapPct))} واحد درصد کمتر از پیشنهاد`;
      return { cls, label: suggested.get(cls)?.label ?? CLASS_LABEL[cls] ?? cls, mine: m, suggested: s, gapPct, advice };
    })
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

  const similarityPct = Math.max(0, Math.min(100, (1 - absDiff / 2) * 100));
  const worst = classes[0];
  const topFix =
    worst && Math.abs(worst.gapPct) >= 5
      ? worst.gapPct > 0
        ? `بیشترین اختلاف در «${worst.label}» است: ${faInt(Math.abs(worst.gapPct))} واحد درصد بیش از پیشنهاد.`
        : `بیشترین اختلاف در «${worst.label}» است: ${faInt(Math.abs(worst.gapPct))} واحد درصد کمتر از پیشنهاد.`
      : null;

  const headline =
    similarityPct >= 80
      ? 'سبد شما تا حد زیادی با سبد پیشنهادی همین افق هم‌راستا است.'
      : similarityPct >= 55
        ? 'سبد شما تا حدی با سبد پیشنهادی هم‌راستا است، ولی چند دسته فاصله معناداری دارند.'
        : 'ترکیب سبد شما با سبد پیشنهادی این افق تفاوت زیادی دارد.';

  return { profile: portfolio.profile, horizon: portfolio.horizon, similarityPct, classes, headline, topFix };
}

const CLASS_LABEL: Record<string, string> = {
  cash: 'درآمد ثابت ریالی',
  usd: 'دلار / تتر',
  gold: 'طلا',
  equity: 'سهام بورس',
  btc: 'بیت‌کوین / اتریوم',
  spec: 'آلت‌کوین پرریسک',
};

/** Full analysis for the holdings page. */
export async function analyzeHoldings(
  items: ValuedHolding[],
  snap: Snapshot,
  opts: { profile?: Profile; horizon?: PortfolioHorizon; totalValue: number },
): Promise<HoldingsAnalysis> {
  const warnings: string[] = [];
  const profile = opts.profile ?? snap.defaultProfile;
  const horizon = opts.horizon ?? 'm3';

  const dated = items.filter((h) => h.boughtOn);
  let seriesFor: (k: RiskAssetKey) => { dates: string[]; prices: number[] } | null = () => null;
  if (dated.length) {
    try {
      const inp = await loadSeriesInputs();
      const cache = new Map<string, { dates: string[]; prices: number[] } | null>();
      seriesFor = (k) => {
        if (!cache.has(k)) {
          try {
            const s = buildSeries(inp, k);
            cache.set(k, s.dates.length ? { dates: s.dates, prices: s.prices } : null);
          } catch {
            cache.set(k, null);
          }
        }
        return cache.get(k) ?? null;
      };
    } catch {
      warnings.push('تاریخچه قیمت بارگذاری نشد؛ تحلیل زمان خرید انجام نشد.');
    }
  }

  const riskOf = (k: RiskAssetKey): AssetRisk | null => snap.risk.find((r) => r.key === k) ?? null;

  const perHolding: HoldingAnalysis[] = items.map((h) => {
    const inst = INSTRUMENT[h.instrument];
    const riskKey = RISK_KEY[h.instrument] ?? null;
    if (!riskKey) {
      return {
        id: h.id,
        riskKey: null,
        entry: { overextension: null, pricePercentile: null, sinceBuyPct: null, priceOnDate: null, premiumPct: null, grade: 'unknown', text: 'برای این دارایی سری قیمت مرجعی نگه نمی‌داریم.' },
        horizons: null,
        annualVolPct: null,
        note: 'ریسک و تحلیل زمان خرید برای این قلم محاسبه نمی‌شود.',
      };
    }
    // same unit only when the holding *is* the reference instrument (18k gram, emami coin, usd, usdt, btc, eth)
    const sameUnit = ['g18', 'coin_emami', 'usd', 'usdt', 'btc', 'eth'].includes(h.instrument);
    const entry = judgeEntry(seriesFor(riskKey), h.boughtOn, h.buyUnitPriceToman, h.unitPriceToman, sameUnit);
    const r = riskOf(riskKey);
    const horizons = r
      ? (Object.fromEntries(
          (Object.keys(HORIZON_LABEL) as HorizonKey[]).map((k) => {
            const hz = r.horizons[k];
            return [k, hz ? { hold: hz.hold, sell: hz.sell, pDown: hz.pDown, expReturnPct: hz.expReturnPct, confidence: hz.confidence } : null];
          }),
        ) as HoldingAnalysis['horizons'])
      : null;
    return {
      id: h.id,
      riskKey,
      entry,
      horizons,
      annualVolPct: r?.annualVolPct ?? null,
      note: inst && riskKey && !sameUnit ? `ریسک بر پایه بازار مرجع «${r?.label ?? riskKey}» محاسبه شده است.` : null,
    };
  });

  const portfolio = snap.portfolios?.[profile]?.[horizon] ?? null;
  const match = portfolio ? comparePortfolio(items, portfolio, opts.totalValue) : null;
  if (!portfolio) warnings.push('سبد پیشنهادی این افق در دسترس نبود؛ درصد تطابق محاسبه نشد.');

  return { perHolding, match, warnings };
}

/** Today in Tehran, for callers that need a default purchase date. */
export const todayTehran = () => tehranDate();
