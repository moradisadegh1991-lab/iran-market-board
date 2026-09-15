// Simulated discretionary-style swing trader for Iranian markets.
// Pure function: no I/O. Everything it "knows" on day t comes from prices dated ≤ t and news published before that day's decision cutoff.
// Orders are decided at a session close and filled at the NEXT available close of that asset, with spread/fee costs.
import { clamp, fmtInt, fmtPct, isNum } from '@/lib/num';
import { ewmaVol, logReturns, mean, rsi, sma, std } from './stats';

export type SimAsset = 'usd' | 'g18' | 'coin' | 'tse' | 'btc' | 'eth' | 'sol' | 'xrp' | 'ton' | 'doge';
export type SimProfile = 'conservative' | 'balanced' | 'aggressive';

export const SIM_ASSETS: { key: SimAsset; label: string; unit: string; crypto: boolean; cost: number; costNote: string; cg?: string }[] = [
  { key: 'usd', label: 'دلار', unit: 'دلار', crypto: false, cost: 0.006, costNote: 'اختلاف خرید و فروش صرافی حدود ۱٫۲٪ رفت‌وبرگشت' },
  { key: 'g18', label: 'طلای ۱۸ عیار', unit: 'گرم', crypto: false, cost: 0.008, costNote: 'طلای آب‌شده؛ اختلاف خرید و فروش حدود ۱٫۶٪، بدون اجرت' },
  { key: 'coin', label: 'سکه امامی', unit: 'سکه', crypto: false, cost: 0.006, costNote: 'اختلاف خرید و فروش حدود ۱٫۲٪؛ مقدار کسری یعنی معادل گواهی سپرده سکه' },
  { key: 'tse', label: 'صندوق شاخصی بورس', unit: 'واحد', crypto: false, cost: 0.005, costNote: 'کارمزد صندوق ETF به‌علاوه خطای ردیابی شاخص، حدود ۰٫۵٪ هر طرف' },
  { key: 'btc', label: 'بیت‌کوین', unit: 'BTC', crypto: true, cost: 0.004, costNote: 'کارمزد صرافی داخلی و اسپرد تتر، حدود ۰٫۴٪ هر طرف', cg: 'bitcoin' },
  { key: 'eth', label: 'اتریوم', unit: 'ETH', crypto: true, cost: 0.004, costNote: 'کارمزد صرافی داخلی و اسپرد تتر، حدود ۰٫۴٪ هر طرف', cg: 'ethereum' },
  // Altcoins tradable on Iranian exchanges. Spreads there are wider than on BTC/ETH, and wider
  // still for the meme name, so each carries its own cost rather than a shared default.
  { key: 'sol', label: 'سولانا', unit: 'SOL', crypto: true, cost: 0.005, costNote: 'کارمزد و اسپرد صرافی داخلی، حدود ۰٫۵٪ هر طرف', cg: 'solana' },
  { key: 'xrp', label: 'ریپل', unit: 'XRP', crypto: true, cost: 0.005, costNote: 'کارمزد و اسپرد صرافی داخلی، حدود ۰٫۵٪ هر طرف', cg: 'ripple' },
  { key: 'ton', label: 'تون‌کوین', unit: 'TON', crypto: true, cost: 0.006, costNote: 'نقدشوندگی کمتر؛ اسپرد حدود ۰٫۶٪ هر طرف', cg: 'the-open-network' },
  { key: 'doge', label: 'دوج‌کوین', unit: 'DOGE', crypto: true, cost: 0.007, costNote: 'میم‌کوین با اسپرد بالاتر، حدود ۰٫۷٪ هر طرف', cg: 'dogecoin' },
];
const META = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<SimAsset, (typeof SIM_ASSETS)[number]>;

export const PROFILES: Record<SimProfile, { label: string; maxW: number; cryptoCap: number; cashFloor: number; targetVol: number; entry: number; exit: number; stopK: number; minStop: number; band: number }> = {
  conservative: { label: 'محتاط', maxW: 0.25, cryptoCap: 0.06, cashFloor: 0.3, targetVol: 0.14, entry: 40, exit: 5, stopK: 2.2, minStop: 0.04, band: 0.05 },
  balanced: { label: 'متعادل', maxW: 0.35, cryptoCap: 0.2, cashFloor: 0.1, targetVol: 0.22, entry: 30, exit: -2, stopK: 2.6, minStop: 0.05, band: 0.05 },
  aggressive: { label: 'جسور', maxW: 0.5, cryptoCap: 0.4, cashFloor: 0, targetVol: 0.35, entry: 22, exit: -10, stopK: 3.0, minStop: 0.07, band: 0.06 },
};

// ─────────────────────────── learnable parameters ───────────────────────────
// The learning loop (lib/engine/learning.ts) only moves these knobs, always inside PARAM_BOUNDS.
// With DEFAULT_PARAMS the engine is exactly the original rule set (scripts/sim-regression.ts guards this).

export type SignalComponent = 'trend' | 'momentum' | 'stretch' | 'bubble' | 'news';
export const SIGNAL_COMPONENTS: { key: SignalComponent; label: string }[] = [
  { key: 'trend', label: 'ساختار روند (میانگین‌های ۲۰ و ۵۰)' },
  { key: 'momentum', label: 'مومنتوم تعدیل‌شده با نوسان' },
  { key: 'stretch', label: 'اشباع خرید و فاصله از سقف' },
  { key: 'bubble', label: 'حباب سکه' },
  { key: 'news', label: 'اخبار' },
];

export interface SimParams {
  version: number; // 0 = untouched defaults
  weights: Record<SignalComponent, number>;
  entryShift: number; // added to the profile's entry threshold (higher = pickier)
  exitShift: number; // added to the profile's exit threshold (lower = more patient)
  stopMult: number; // × trailing-stop width
  bandMult: number; // × rebalancing band (higher = fewer small trades)
  minHoldDays: number;
  cooldownDays: number; // no re-entry after a stop
  assetTrust: Record<SimAsset, number>; // × position size per asset
}

export const DEFAULT_PARAMS: SimParams = {
  version: 0,
  weights: { trend: 1, momentum: 1, stretch: 1, bubble: 1, news: 1 },
  entryShift: 0,
  exitShift: 0,
  stopMult: 1,
  bandMult: 1,
  minHoldDays: 5,
  cooldownDays: 10,
  assetTrust: { usd: 1, g18: 1, coin: 1, tse: 1, btc: 1, eth: 1, sol: 1, xrp: 1, ton: 1, doge: 1 },
};

export const PARAM_BOUNDS = {
  weight: [0.3, 2] as const,
  entryShift: [-10, 15] as const,
  exitShift: [-15, 10] as const,
  stopMult: [0.7, 1.6] as const,
  bandMult: [0.6, 2] as const,
  minHoldDays: [3, 15] as const,
  cooldownDays: [5, 20] as const,
  assetTrust: [0.4, 1.4] as const,
};

/** Fill any missing fields (older stored params) and clamp everything into bounds. */
export function normalizeParams(p: Partial<SimParams> | null | undefined): SimParams {
  const d = DEFAULT_PARAMS;
  const c = (v: unknown, [lo, hi]: readonly [number, number], dv: number) => (isNum(v as number) ? clamp(v as number, lo, hi) : dv);
  return {
    version: isNum(p?.version) ? p!.version : 0,
    weights: Object.fromEntries(SIGNAL_COMPONENTS.map(({ key }) => [key, c(p?.weights?.[key], PARAM_BOUNDS.weight, d.weights[key])])) as SimParams['weights'],
    entryShift: c(p?.entryShift, PARAM_BOUNDS.entryShift, d.entryShift),
    exitShift: c(p?.exitShift, PARAM_BOUNDS.exitShift, d.exitShift),
    stopMult: c(p?.stopMult, PARAM_BOUNDS.stopMult, d.stopMult),
    bandMult: c(p?.bandMult, PARAM_BOUNDS.bandMult, d.bandMult),
    minHoldDays: c(p?.minHoldDays, PARAM_BOUNDS.minHoldDays, d.minHoldDays),
    cooldownDays: c(p?.cooldownDays, PARAM_BOUNDS.cooldownDays, d.cooldownDays),
    assetTrust: Object.fromEntries(SIM_ASSETS.map(({ key }) => [key, c(p?.assetTrust?.[key], PARAM_BOUNDS.assetTrust, d.assetTrust[key])])) as SimParams['assetTrust'],
  };
}

export type EffectiveProfile = (typeof PROFILES)[SimProfile] & { minHoldDays: number; cooldownDays: number };

/** Profile thresholds after applying the learned shifts/multipliers. With defaults every value is unchanged. */
export type Activity = 'calm' | 'normal' | 'active';
export const ACTIVITY_LABEL: Record<Activity, string> = { calm: 'کم‌معامله', normal: 'متعادل', active: 'پرمعامله' };

/**
 * How eager the engine is to act, expressed through the parameters it already has:
 * a lower entry threshold and a narrower rebalance band mean more decisions, and shorter
 * hold/cooldown windows let it come back sooner.
 *
 * More trades is not the same as more profit — every extra round trip pays the spread twice.
 * scripts/activity-test.ts measures return, fees and trade count side by side so the choice
 * can be made on evidence rather than on the feeling that a busy engine is a smart one.
 */
export function applyActivity(params: SimParams, level: Activity): SimParams {
  if (level === 'normal') return params;
  const k = level === 'active'
    ? { entryShift: -7, exitShift: +4, bandMult: 0.45, hold: 0.35, cool: 0.3 }
    : { entryShift: +5, exitShift: -3, bandMult: 1.35, hold: 1.4, cool: 1.4 };
  return {
    ...params,
    entryShift: params.entryShift + k.entryShift,
    exitShift: params.exitShift + k.exitShift,
    bandMult: params.bandMult * k.bandMult,
    minHoldDays: Math.max(1, params.minHoldDays * k.hold),
    cooldownDays: Math.max(1, params.cooldownDays * k.cool),
  };
}

export function effectiveProfile(profile: SimProfile, params: SimParams): EffectiveProfile {
  const p = PROFILES[profile];
  return {
    ...p,
    entry: p.entry + params.entryShift,
    exit: p.exit + params.exitShift,
    stopK: p.stopK * params.stopMult,
    minStop: p.minStop * params.stopMult,
    band: p.band * params.bandMult,
    minHoldDays: Math.round(params.minHoldDays),
    cooldownDays: Math.round(params.cooldownDays),
  };
}

export interface SimSeries {
  key: SimAsset;
  dates: string[]; // ascending YYYY-MM-DD
  prices: number[]; // rial per unit
  basis: string;
  reconstructed: boolean;
}

export interface ScoredNews {
  id: string;
  date: string; // Tehran date of publication
  ms: number;
  title: string;
  source: string;
  url: string;
  effects: Partial<Record<SimAsset, number>>; // −1..+1 expected price direction
  facts: string[];
  weight: number;
}

export interface SimInput {
  start: string;
  end: string;
  capitalToman: number;
  profile: SimProfile;
  assets: SimAsset[];
  fixedIncomeYield: number; // e.g. 0.30
  series: Partial<Record<SimAsset, SimSeries>>;
  ons?: { dates: string[]; prices: number[] }; // USD/oz, for the coin bubble
  usdRef?: { dates: string[]; prices: number[] }; // rial, for "return in dollars" and bubble
  news: ScoredNews[];
}

export interface NewsRef {
  id: string;
  date: string;
  title: string;
  source: string;
  url: string;
  facts: string[];
  effect: number; // effect on this asset
}

export type TradeKind = 'entry' | 'add' | 'trim' | 'exit' | 'stop' | 'take_profit';

export interface SimTrade {
  n: number;
  decisionDate: string;
  date: string; // fill date
  asset: SimAsset;
  side: 'buy' | 'sell';
  kind: TradeKind;
  qty: number;
  price: number; // fill price incl. spread, rial
  valueToman: number;
  feeToman: number;
  realizedToman: number | null;
  realizedPct: number | null;
  holdDays: number | null;
  score: number;
  newsScore: number;
  weightAfter: number;
  reasons: string[];
  news: NewsRef[];
  components?: Record<SignalComponent, number>; // signal parts at decision time (unweighted) — used for credit assignment
  paramsVersion?: number;
}

export interface EquityPoint {
  date: string;
  equity: number; // toman
  cash: number;
  invested: number;
  deposit: number;
  usdHold: number | null;
  equal: number | null;
  equityUsd: number | null;
}

export interface AssetAttribution {
  asset: SimAsset;
  label: string;
  marketPct: number | null; // price change over the window
  realizedToman: number;
  unrealizedToman: number;
  feesToman: number;
  trades: number;
  daysHeld: number;
  basis: string;
  reconstructed: boolean;
}

export interface SimMetrics {
  days: number;
  startEquity: number;
  finalEquity: number;
  pnlToman: number;
  returnPct: number;
  annualizedPct: number | null;
  usdReturnPct: number | null;
  maxDrawdownPct: number;
  maxDrawdownFrom: string | null;
  maxDrawdownTo: string | null;
  annualVolPct: number | null;
  sharpe: number | null;
  trades: number;
  closedTrades: number;
  winRatePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  feesToman: number;
  interestToman: number;
  avgExposurePct: number;
  stops: number;
  newsDrivenTrades: number;
}

export interface Benchmark {
  key: string;
  label: string;
  finalToman: number;
  returnPct: number;
}

export interface SimResult {
  input: { start: string; end: string; capitalToman: number; profile: SimProfile; assets: SimAsset[]; fixedIncomeYield: number };
  metrics: SimMetrics;
  trades: SimTrade[];
  equity: EquityPoint[];
  benchmarks: Benchmark[];
  attribution: AssetAttribution[];
  newsUsed: (ScoredNews & { usedIn: number[] })[];
  analysis: { title: string; body: string }[];
  warnings: string[];
  paramsVersion: number;
}

// ─────────────────────────── helpers ───────────────────────────

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
/** decisions happen after the Tehran close (~16:00 = 12:30 UTC); only news published before that is visible */
const cutoffMs = (date: string) => Date.parse(`${date}T12:30:00Z`);

export class PriceBook {
  private idx = new Map<string, number>();
  constructor(public dates: string[], public prices: number[]) {
    dates.forEach((d, i) => this.idx.set(d, i));
  }
  has(d: string) {
    return this.idx.has(d);
  }
  /** index of last observation dated ≤ d */
  lastIdx(d: string): number {
    let lo = 0, hi = this.dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= d) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }
  priceAt(d: string): number | null {
    const i = this.lastIdx(d);
    return i >= 0 ? this.prices[i] : null;
  }
  history(d: string, n: number): number[] {
    const i = this.lastIdx(d);
    return i < 0 ? [] : this.prices.slice(Math.max(0, i - n + 1), i + 1);
  }
  periodsPerYear(d: string): number {
    const i = this.lastIdx(d);
    const j = Math.max(0, i - 120);
    const span = i > j ? daysBetween(this.dates[j], this.dates[i]) : 0;
    return span > 20 ? clamp(((i - j) * 365) / span, 200, 366) : 300;
  }
}

export interface Signal {
  score: number;
  newsScore: number;
  components: Record<SignalComponent, number>;
  annVol: number;
  rsi: number | null;
  reasonsUp: string[];
  reasonsDown: string[];
  news: NewsRef[];
  ppy: number;
}

export interface Position {
  qty: number;
  cost: number; // rial, incl. buy fees
  entryDate: string;
  entryPrice: number;
  peak: number;
  stopDist: number;
  tookProfit: boolean;
  lastBuy: string;
  realized: number; // toman
  fees: number; // toman
  trades: number;
  daysHeld: number;
}

export interface Order {
  asset: SimAsset;
  side: 'buy' | 'sell';
  kind: TradeKind;
  decisionDate: string;
  valueRial?: number; // buys
  qtyFraction?: number; // sells, of the position at fill time
  signal: Signal;
  targetW: number;
  reasons: string[];
}

const pctTxt = (x: number, d = 0) => fmtPct(x * 100, d);
const pctAbs = (x: number, d = 0) => fmtPct(x * 100, d, false);

export function signalFor(
  asset: SimAsset,
  book: PriceBook,
  date: string,
  input: Pick<SimInput, 'news'>,
  bubbleBooks: { ons?: PriceBook; usd?: PriceBook },
  params: SimParams = DEFAULT_PARAMS,
  cut: number = cutoffMs(date),
): Signal | null {
  const p = book.history(date, 130);
  if (p.length < 62) return null;
  const last = p[p.length - 1];
  const ppy = book.periodsPerYear(date);
  const r = logReturns(p.slice(-61));
  const dailyVol = Math.max(ewmaVol(r, 0.94), std(r) * 0.6, 1e-4);
  const annVol = dailyVol * Math.sqrt(ppy);
  const s20 = sma(p, 20)!;
  const s50 = sma(p, 50)!;
  const ret20 = last / p[p.length - 21] - 1;
  const ret60 = last / p[p.length - 61] - 1;
  const R = rsi(p.slice(-60), 14);
  const up: string[] = [];
  const down: string[] = [];
  let score = 0; // original accumulation order — kept so default weights reproduce the rule set bit-for-bit
  const comp: Record<SignalComponent, number> = { trend: 0, momentum: 0, stretch: 0, bubble: 0, news: 0 };

  // 1) trend structure
  if (s20 > s50) {
    score += 15;
    comp.trend += 15;
    up.push('میانگین ۲۰ روزه بالای میانگین ۵۰ روزه است (روند صعودی)');
  } else {
    score -= 15;
    comp.trend -= 15;
    down.push('میانگین ۲۰ روزه زیر میانگین ۵۰ روزه است (روند نزولی)');
  }
  if (last > s50) {
    score += 15;
    comp.trend += 15;
    up.push(`قیمت ${pctTxt(last / s50 - 1, 1)} بالاتر از میانگین ۵۰ روزه`);
  } else {
    score -= 15;
    comp.trend -= 15;
    down.push(`قیمت ${pctTxt(last / s50 - 1, 1)} نسبت به میانگین ۵۰ روزه`);
  }

  // 2) risk-adjusted momentum
  const z60 = Math.log(1 + ret60) / (annVol * Math.sqrt(60 / ppy));
  const m60 = 25 * Math.tanh(z60 / 1.5);
  score += m60;
  comp.momentum += m60;
  (m60 >= 0 ? up : down).push(`بازده ۶۰ جلسه اخیر ${pctTxt(ret60, 1)}`);
  const z20 = Math.log(1 + ret20) / (annVol * Math.sqrt(20 / ppy));
  const m20 = 10 * Math.tanh(z20 / 1.5);
  score += m20;
  comp.momentum += m20;

  // 3) stretch / pullback
  if (isNum(R)) {
    if (R > 76) {
      score -= 15;
      comp.stretch -= 15;
      down.push(`RSI برابر ${fmtInt(R)}؛ اشباع خرید و خطر اصلاح`);
    } else if (R > 68) {
      score -= 6;
      comp.stretch -= 6;
      down.push(`RSI برابر ${fmtInt(R)}؛ نزدیک اشباع خرید`);
    } else if (R < 30 && s20 > s50) {
      score += 8;
      comp.stretch += 8;
      up.push(`RSI برابر ${fmtInt(R)}؛ پولبک در دل روند صعودی`);
    }
  }
  const hi60 = Math.max(...p.slice(-60));
  if (last < hi60 * 0.85 && s20 < s50) {
    score -= 10;
    comp.stretch -= 10;
    down.push(`${pctAbs(1 - last / hi60, 0)} زیر سقف ۶۰ جلسه‌ای`);
  }

  // 4) coin bubble vs its own recent norm
  if (asset === 'coin' && bubbleBooks.ons && bubbleBooks.usd) {
    const bubbleAt = (d: string) => {
      const c = book.priceAt(d), o = bubbleBooks.ons!.priceAt(d), u = bubbleBooks.usd!.priceAt(d);
      return isNum(c) && isNum(o) && isNum(u) ? c / ((o / 31.1035) * 7.3224 * u) - 1 : null;
    };
    const now = bubbleAt(date);
    const past = Array.from({ length: 12 }, (_, i) => bubbleAt(addDays(date, -7 * (i + 1)))).filter(isNum);
    if (isNum(now) && past.length >= 6) {
      const norm = mean(past);
      if (now - norm > 0.05) {
        score -= 12;
        comp.bubble -= 12;
        down.push(`حباب سکه ${pctAbs(now, 0)}، بالاتر از میانگین سه ماه اخیر (${pctAbs(norm, 0)})`);
      } else if (now > 0.25) {
        score -= 8;
        comp.bubble -= 8;
        down.push(`حباب سکه ${pctAbs(now, 0)}؛ گران نسبت به طلای خام`);
      } else if (norm - now > 0.04) {
        score += 6;
        comp.bubble += 6;
        up.push(`حباب سکه ${pctAbs(now, 0)}، کمتر از میانگین سه ماه اخیر`);
      }
    }
  }

  // 5) news — only items published before this session's decision cutoff, decaying over ~4 days
  let newsSum = 0;
  const refs: (NewsRef & { contrib: number })[] = [];
  const from = addDays(date, -10);
  for (const n of input.news) {
    if (n.ms > cut || n.date < from) continue;
    const e = n.effects[asset];
    if (!isNum(e) || e === 0) continue;
    const age = Math.max(0, (cut - n.ms) / DAY);
    const contrib = e * n.weight * Math.exp(-age / 4);
    newsSum += contrib;
    refs.push({ id: n.id, date: n.date, title: n.title, source: n.source, url: n.url, facts: n.facts, effect: e, contrib });
  }
  const rawNews = 20 * Math.tanh(newsSum / 1.6);
  score += rawNews;
  comp.news = rawNews;
  const w = params.weights;
  const neutral = w.trend === 1 && w.momentum === 1 && w.stretch === 1 && w.bubble === 1 && w.news === 1;
  if (!neutral) score = SIGNAL_COMPONENTS.reduce((acc, { key }) => acc + w[key] * comp[key], 0);
  const newsScore = rawNews * w.news;
  const topNews = refs.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 3);
  if (Math.abs(newsScore) >= 3) {
    const facts = [...new Set(topNews.filter((n) => Math.sign(n.contrib) === Math.sign(newsScore)).flatMap((n) => n.facts))].slice(0, 2);
    (newsScore > 0 ? up : down).push(`جمع‌بندی اخبار ۱۰ روز اخیر ${newsScore > 0 ? 'مثبت' : 'منفی'} است: ${facts.join('، ')}`);
  }

  return { score: clamp(score, -100, 100), newsScore, components: comp, annVol, rsi: R, reasonsUp: up, reasonsDown: down, news: topNews.map(({ contrib: _c, ...n }) => n), ppy };
}

// ─────────────────────────── simulation ───────────────────────────

export function simulate(input: SimInput, paramsIn?: Partial<SimParams> | null): SimResult {
  const params = normalizeParams(paramsIn ?? DEFAULT_PARAMS);
  const prof = effectiveProfile(input.profile, params);
  const warnings: string[] = [];
  const books = new Map<SimAsset, PriceBook>();
  for (const a of input.assets) {
    const s = input.series[a];
    if (!s || s.dates.length < 70) {
      warnings.push(`${META[a].label}: تاریخچه کافی نبود و از شبیه‌سازی کنار گذاشته شد.`);
      continue;
    }
    books.set(a, new PriceBook(s.dates, s.prices));
    if (s.reconstructed) warnings.push(`${META[a].label}: بخشی از تاریخچه از ${s.basis} بازسازی شده است، نه قیمت مستقیم همان بازار.`);
  }
  const active = [...books.keys()];
  const bubbleBooks = {
    ons: input.ons && input.ons.dates.length ? new PriceBook(input.ons.dates, input.ons.prices) : undefined,
    usd: input.usdRef && input.usdRef.dates.length ? new PriceBook(input.usdRef.dates, input.usdRef.prices) : undefined,
  };

  // calendar: every day in the window that has at least one real price
  const dateSet = new Set<string>();
  for (const b of books.values()) for (const d of b.dates) if (d >= input.start && d <= input.end) dateSet.add(d);
  const calendar = [...dateSet].sort();
  if (calendar.length < 10) throw new Error('در این بازه داده قیمت کافی وجود ندارد.');

  const capitalRial = input.capitalToman * 10;
  const acct: Account = { cash: capitalRial, interestRial: 0, feesToman: 0 };
  const dailyYield = Math.pow(1 + input.fixedIncomeYield, 1 / 365) - 1;
  const pos = new Map<SimAsset, Position>();
  const cooldown = new Map<SimAsset, string>();
  const trades: SimTrade[] = [];
  const pending: Order[] = [];
  const equity: EquityPoint[] = [];
  const lastSignal = new Map<SimAsset, Signal>();
  const newsUse = new Map<string, number[]>();
  const exposures: number[] = [];

  const valueOf = (a: SimAsset, d: string) => {
    const p = pos.get(a);
    if (!p || p.qty <= 0) return 0;
    return p.qty * (books.get(a)!.priceAt(d) ?? p.entryPrice);
  };
  const totalEquity = (d: string) => acct.cash + active.reduce((s, a) => s + valueOf(a, d), 0);

  // benchmarks
  const usdBook = bubbleBooks.usd ?? books.get('usd');
  const startUsd = usdBook?.priceAt(calendar[0]) ?? null;
  const eqStartPrices = new Map(active.map((a) => [a, books.get(a)!.priceAt(calendar[0])]));

  let prevDate = calendar[0];
  let nextReview = calendar[0];
  let lastReview: string | null = null;

  for (const date of calendar) {
    // 1) interest on idle cash (calendar days since previous session)
    const gap = Math.max(0, daysBetween(prevDate, date));
    if (gap > 0) {
      const inc = acct.cash * (Math.pow(1 + dailyYield, gap) - 1);
      acct.cash += inc;
      acct.interestRial += inc;
    }
    prevDate = date;

    // 2) fill orders decided on earlier sessions, at today's close of that asset (if it traded today)
    for (let i = 0; i < pending.length; ) {
      const o = pending[i];
      const book = books.get(o.asset)!;
      if (!book.has(date) || date <= o.decisionDate) {
        i++;
        continue;
      }
      pending.splice(i, 1);
      const fill = executeOrder(o, book.priceAt(date)!, date, acct, pos, cooldown, prof, totalEquity(date));
      if (fill) record(o, date, fill);
    }

    // 3) mark-to-market, trailing stops, take-profit (daily)
    for (const a of active) {
      const p = pos.get(a);
      const book = books.get(a)!;
      if (!p || p.qty <= 0 || !book.has(date)) continue;
      p.daysHeld++;
      const px = book.priceAt(date)!;
      p.peak = Math.max(p.peak, px);
      if (pending.some((o) => o.asset === a && o.side === 'sell')) continue;
      const sig = signalFor(a, book, date, input, bubbleBooks, params);
      const exit = checkExit(a, p, px, sig, lastSignal.get(a), date, prof);
      if (exit) pending.push(exit);
    }

    // 4) weekly review; plus an immediate review limited to the affected assets when a NEW high-impact event breaks
    if (date >= nextReview) {
      review(date, null);
      nextReview = addDays(date, 7);
      lastReview = date;
    } else {
      const shock = findShockIn(input.news, active, date, lastReview, cutoffMs(date));
      if (shock) {
        review(date, shock);
        lastReview = date;
      }
    }

    const eq = totalEquity(date);
    const invested = eq - acct.cash;
    exposures.push(eq > 0 ? invested / eq : 0);
    const usdNow = usdBook?.priceAt(date) ?? null;
    let equal: number | null = null;
    const eqParts = active.map((a) => {
      const p0 = eqStartPrices.get(a), p1 = books.get(a)!.priceAt(date);
      return isNum(p0) && isNum(p1) ? (p1 / p0) * (1 - META[a].cost) : null;
    });
    if (eqParts.every(isNum)) equal = (input.capitalToman * mean(eqParts as number[]));
    equity.push({
      date,
      equity: eq / 10,
      cash: acct.cash / 10,
      invested: invested / 10,
      deposit: input.capitalToman * Math.pow(1 + input.fixedIncomeYield, daysBetween(calendar[0], date) / 365),
      usdHold: isNum(startUsd) && isNum(usdNow) ? input.capitalToman * (1 - META.usd.cost) * (usdNow / startUsd) : null,
      equal,
      equityUsd: isNum(usdNow) ? eq / usdNow : null,
    });
  }

  function review(date: string, shock: Shock | null) {
    const eq = totalEquity(date);
    const sigs = new Map<SimAsset, Signal>();
    for (const a of active) {
      const s = signalFor(a, books.get(a)!, date, input, bubbleBooks, params);
      if (s) {
        sigs.set(a, s);
        lastSignal.set(a, s);
      }
    }
    const orders = planReview({
      date, sigs, eq, prof, params, shock,
      weightOf: (a) => valueOf(a, date) / eq,
      position: (a) => pos.get(a),
      hasPending: (a) => pending.some((o) => o.asset === a),
      cooldownUntil: (a) => cooldown.get(a),
    });
    pending.push(...orders);
  }

  function record(o: Order, date: string, f: Fill) {
    const n = trades.length + 1;
    trades.push(tradeRecord(o, n, date, f, totalEquity(date), valueOf(o.asset, date), newsUse, params.version));
  }

  const result = buildResult({
    input: { start: calendar[0], end: calendar[calendar.length - 1], capitalToman: input.capitalToman, profile: input.profile, assets: active, fixedIncomeYield: input.fixedIncomeYield },
    firstDate: calendar[0],
    lastDate: calendar[calendar.length - 1],
    equity, trades, exposures, acct, pos,
    priceStart: (a) => books.get(a)!.priceAt(calendar[0]),
    priceEnd: (a) => books.get(a)!.priceAt(calendar[calendar.length - 1]),
    series: input.series,
    startUsd,
    news: input.news,
    newsUse,
    warnings,
    paramsVersion: params.version,
  });
  result.analysis = analyse(result, input.news.length);
  return result;
}

// ─────────────────────────── shared building blocks (backtest + live) ───────────────────────────

export interface Account {
  cash: number; // rial
  interestRial: number;
  feesToman: number;
}

export type Shock = { news: ScoredNews; assets: SimAsset[] };

/** A headline counts as a shock only if it is a fundamental event (not a price report), hits an asset hard,
 *  its theme was not already in the news during the previous 5 days, and the book was not reviewed in the last 3 days. */
export function findShockIn(news: ScoredNews[], active: SimAsset[], date: string, lastReview: string | null, cut: number): Shock | null {
  if (lastReview && daysBetween(lastReview, date) < 3) return null;
  const from = addDays(date, -5);
  for (const n of news) {
    if (n.date !== date || n.ms > cut || n.weight < 0.8) continue;
    const hit = active.filter((a) => Math.abs(n.effects[a] ?? 0) >= 0.6);
    if (!hit.length) continue;
    const stale = news.some((m) => m.id !== n.id && m.ms < n.ms && m.date >= from && m.facts.some((f) => n.facts.includes(f)));
    if (!stale) return { news: n, assets: hit };
  }
  return null;
}

export interface Fill {
  qty: number;
  fill: number; // rial per unit incl. spread
  valueRial: number;
  feeRial: number;
  realized: number | null; // toman
  realizedPct: number | null;
  hold: number | null;
}

/** Applies an order at market price `mkt` (rial). Mutates account, positions and cooldown. Returns null when nothing traded. */
export function executeOrder(o: Order, mkt: number, date: string, acct: Account, pos: Map<SimAsset, Position>, cooldown: Map<SimAsset, string>, prof: EffectiveProfile, eqNow: number): Fill | null {
  const cost = META[o.asset].cost;
  if (o.side === 'buy') {
    const budget = Math.min(o.valueRial ?? 0, acct.cash);
    if (budget < eqNow * 0.01) return null;
    const fill = mkt * (1 + cost);
    const qty = budget / fill;
    const fee = budget - qty * mkt;
    acct.cash -= budget;
    acct.feesToman += fee / 10;
    const prev = pos.get(o.asset);
    const stopDist = Math.max(prof.minStop, prof.stopK * o.signal.annVol * Math.sqrt(10 / o.signal.ppy));
    if (prev && prev.qty > 0) {
      prev.qty += qty;
      prev.cost += budget;
      prev.peak = Math.max(prev.peak, mkt);
      prev.lastBuy = date;
      prev.fees += fee / 10;
      prev.trades++;
    } else {
      pos.set(o.asset, { qty, cost: budget, entryDate: date, entryPrice: mkt, peak: mkt, stopDist, tookProfit: false, lastBuy: date, realized: prev?.realized ?? 0, fees: (prev?.fees ?? 0) + fee / 10, trades: (prev?.trades ?? 0) + 1, daysHeld: prev?.daysHeld ?? 0 });
    }
    return { qty, fill, valueRial: budget, feeRial: fee, realized: null, realizedPct: null, hold: null };
  }
  const p = pos.get(o.asset);
  if (!p || p.qty <= 0) return null;
  const qty = p.qty * clamp(o.qtyFraction ?? 1, 0, 1);
  const fill = mkt * (1 - cost);
  const proceeds = qty * fill;
  const fee = qty * mkt - proceeds;
  const costPart = p.cost * (qty / p.qty);
  const realized = (proceeds - costPart) / 10;
  acct.cash += proceeds;
  acct.feesToman += fee / 10;
  p.qty -= qty;
  p.cost -= costPart;
  p.realized += realized;
  p.fees += fee / 10;
  p.trades++;
  const hold = daysBetween(p.entryDate, date);
  if (p.qty <= 1e-12) {
    p.qty = 0;
    p.cost = 0;
    if (o.kind === 'stop') cooldown.set(o.asset, addDays(date, prof.cooldownDays));
  }
  return { qty, fill, valueRial: proceeds, feeRial: fee, realized, realizedPct: (proceeds / costPart - 1) * 100, hold };
}

/** Trailing stop or partial take-profit for one held position at price `px`. May set p.tookProfit. */
export function checkExit(a: SimAsset, p: Position, px: number, sig: Signal | null, lastSig: Signal | undefined, date: string, prof: EffectiveProfile): Order | null {
  if (px <= p.peak * (1 - p.stopDist)) {
    return {
      asset: a, side: 'sell', kind: 'stop', decisionDate: date, qtyFraction: 1, targetW: 0,
      signal: sig ?? lastSig!,
      reasons: [`حد ضرر متحرک فعال شد: قیمت ${pctTxt(px / p.peak - 1, 1)} از بالاترین قیمت پس از خرید پایین آمد (فاصله مجاز ${pctAbs(p.stopDist, 1)})`, `خروج کامل بدون توجه به دیدگاه قبلی؛ ${fmtInt(prof.cooldownDays)} روز ورود دوباره ممنوع`],
    };
  }
  if (!p.tookProfit && sig && px >= p.entryPrice * (1 + 3 * p.stopDist) && isNum(sig.rsi) && sig.rsi > 72) {
    p.tookProfit = true;
    return {
      asset: a, side: 'sell', kind: 'take_profit', decisionDate: date, qtyFraction: 1 / 3, targetW: 0,
      signal: sig,
      reasons: [`قیمت ${pctTxt(px / p.entryPrice - 1, 1)} بالاتر از قیمت ورود است (سه برابر فاصله حد ضرر)`, `RSI برابر ${fmtInt(sig.rsi)}؛ برداشت یک‌سوم سود و ادامه با باقی موقعیت`],
    };
  }
  return null;
}

export interface ReviewArgs {
  date: string;
  sigs: Map<SimAsset, Signal>;
  eq: number;
  prof: EffectiveProfile;
  params: SimParams;
  shock: Shock | null;
  weightOf: (a: SimAsset) => number;
  position: (a: SimAsset) => Position | undefined;
  hasPending: (a: SimAsset) => boolean;
  cooldownUntil: (a: SimAsset) => string | undefined;
}

/** Target weights from signals, portfolio limits, then the orders needed to get there. */
export function planReview({ date, sigs, eq, prof, params, shock, weightOf, position, hasPending, cooldownUntil }: ReviewArgs): Order[] {
  const target = new Map<SimAsset, number>();
  for (const [a, s] of sigs) {
    const held = (position(a)?.qty ?? 0) > 0;
    const curW = weightOf(a);
    const cd = cooldownUntil(a);
    if (s.score >= prof.entry && !(cd && date < cd)) {
      const conviction = (s.score - prof.entry) / (100 - prof.entry);
      const volScale = Math.min(1, prof.targetVol / Math.max(s.annVol, 0.02));
      target.set(a, prof.maxW * (0.45 + 0.55 * conviction) * volScale * params.assetTrust[a]);
    } else if (held && s.score > prof.exit) target.set(a, Math.min(curW, prof.maxW * 1.15));
    else target.set(a, 0);
  }
  // portfolio limits: crypto cap, then total ≤ 1 − cash floor
  const cryptoSum = [...target].filter(([a]) => META[a].crypto).reduce((s, [, w]) => s + w, 0);
  if (cryptoSum > prof.cryptoCap) for (const [a, w] of target) if (META[a].crypto) target.set(a, (w * prof.cryptoCap) / cryptoSum);
  const tot = [...target.values()].reduce((s, w) => s + w, 0);
  if (tot > 1 - prof.cashFloor) for (const [a, w] of target) target.set(a, (w * (1 - prof.cashFloor)) / tot);

  const orders: Order[] = [];
  const prefix = shock ? `بازبینی فوری پس از خبر «${shock.news.title.slice(0, 90)}» (${shock.news.source})` : null;
  // sells first so that cash is available for buys filled on the same session
  const order = [...target.keys()].sort((x, y) => (target.get(x)! - weightOf(x)) - (target.get(y)! - weightOf(y)));
  for (const a of order) {
    if (hasPending(a)) continue;
    if (shock && !shock.assets.includes(a)) continue; // an event review only touches the assets the event is about
    const s = sigs.get(a)!;
    const p = position(a);
    const held = !!p && p.qty > 0;
    const curW = weightOf(a);
    const tw = target.get(a)!;
    const diff = tw - curW;
    const why = (list: string[]) => [...(prefix ? [prefix] : []), ...list];
    if (held && tw === 0) {
      if (daysBetween(p!.lastBuy, date) < prof.minHoldDays && s.score > prof.exit - 15) continue; // minimum holding period unless the picture collapsed
      orders.push({ asset: a, side: 'sell', kind: 'exit', decisionDate: date, qtyFraction: 1, targetW: 0, signal: s,
        reasons: why([`امتیاز ${fmtInt(s.score)} به زیر آستانه خروج (${fmtInt(prof.exit)}) رسید`, ...s.reasonsDown.slice(0, 3)]) });
    } else if (held && diff < -prof.band) {
      orders.push({ asset: a, side: 'sell', kind: 'trim', decisionDate: date, qtyFraction: clamp(-diff / curW, 0, 1), targetW: tw, signal: s,
        reasons: why([`کاهش وزن از ${pctAbs(curW)} به ${pctAbs(tw)} سبد`, ...(s.reasonsDown.length ? s.reasonsDown.slice(0, 2) : ['رشد قیمت وزن این دارایی را از سقف مجاز پروفایل بالاتر برده است'])]) });
    } else if (diff > prof.band || (!held && tw >= 0.03 && diff > 0.03)) {
      orders.push({ asset: a, side: 'buy', kind: held ? 'add' : 'entry', decisionDate: date, valueRial: diff * eq, targetW: tw, signal: s,
        reasons: why([
          `امتیاز ${fmtInt(s.score)} از آستانه ورود (${fmtInt(prof.entry)}) بالاتر است؛ وزن هدف ${pctAbs(tw)} سبد`,
          ...s.reasonsUp.slice(0, 3),
          `نوسان سالانه ${pctAbs(s.annVol)}؛ اندازه موقعیت با هدف نوسان ${pctAbs(prof.targetVol)} تنظیم شد`,
          ...(s.reasonsDown.length ? [`ریسک در نظر گرفته‌شده: ${s.reasonsDown[0]}`] : []),
        ]) });
    }
  }
  return orders;
}

export function tradeRecord(o: Order, n: number, date: string, f: Fill, eqAfter: number, assetValueAfter: number, newsUse: Map<string, number[]>, paramsVersion: number): SimTrade {
  const useNews = Math.abs(o.signal.newsScore) >= 3 || o.reasons.some((r) => r.startsWith('بازبینی فوری'));
  const news = useNews ? o.signal.news : [];
  for (const ref of news) newsUse.set(ref.id, [...(newsUse.get(ref.id) ?? []), n]);
  return {
    n, decisionDate: o.decisionDate, date, asset: o.asset, side: o.side, kind: o.kind, qty: f.qty, price: f.fill,
    valueToman: f.valueRial / 10, feeToman: f.feeRial / 10, realizedToman: f.realized, realizedPct: f.realizedPct, holdDays: f.hold,
    score: Math.round(o.signal.score), newsScore: Math.round(o.signal.newsScore), weightAfter: eqAfter > 0 ? assetValueAfter / eqAfter : 0,
    reasons: o.reasons, news, components: { ...o.signal.components }, paramsVersion,
  };
}

export interface ResultArgs {
  input: SimResult['input'];
  firstDate: string;
  lastDate: string;
  equity: EquityPoint[];
  trades: SimTrade[];
  exposures: number[];
  acct: Account;
  pos: Map<SimAsset, Position>;
  priceStart: (a: SimAsset) => number | null;
  priceEnd: (a: SimAsset) => number | null;
  series: Partial<Record<SimAsset, { basis: string; reconstructed: boolean }>>;
  startUsd: number | null;
  news: ScoredNews[];
  newsUse: Map<string, number[]>;
  warnings: string[];
  paramsVersion: number;
}

/** Metrics, attribution and benchmarks from a finished run (backtest or live session). */
export function buildResult(x: ResultArgs): SimResult {
  const { input, equity, trades, acct, pos } = x;
  const active = input.assets;
  const capitalRial = input.capitalToman * 10;
  const eqSeries = equity.map((e) => e.equity);
  const finalEquity = eqSeries[eqSeries.length - 1];
  const days = Math.max(1, daysBetween(x.firstDate, x.lastDate));
  let peak = -Infinity, mdd = 0, peakDate = x.firstDate, mddFrom: string | null = null, mddTo: string | null = null;
  for (const e of equity) {
    if (e.equity > peak) {
      peak = e.equity;
      peakDate = e.date;
    }
    const dd = e.equity / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      mddFrom = peakDate;
      mddTo = e.date;
    }
  }
  const eqR = logReturns(eqSeries);
  const ppyEq = days > 20 ? (equity.length * 365) / days : 300;
  const annVol = eqR.length > 10 ? std(eqR) * Math.sqrt(ppyEq) : null;
  const returnPct = (finalEquity / input.capitalToman - 1) * 100;
  const annualized = days >= 60 ? (Math.pow(finalEquity / input.capitalToman, 365 / days) - 1) * 100 : null;
  const sells = trades.filter((t) => t.side === 'sell' && isNum(t.realizedPct));
  const wins = sells.filter((t) => t.realizedToman! > 0);
  const losses = sells.filter((t) => t.realizedToman! <= 0);
  const grossWin = wins.reduce((s, t) => s + t.realizedToman!, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.realizedToman!, 0);
  const firstEqUsd = equity[0]?.equityUsd, lastEqUsd = equity[equity.length - 1]?.equityUsd;
  const usdReturnPct = isNum(firstEqUsd) && isNum(lastEqUsd) && isNum(x.startUsd) ? (lastEqUsd / (capitalRial / x.startUsd) - 1) * 100 : null;

  const metrics: SimMetrics = {
    days,
    startEquity: input.capitalToman,
    finalEquity,
    pnlToman: finalEquity - input.capitalToman,
    returnPct,
    annualizedPct: annualized,
    usdReturnPct,
    maxDrawdownPct: mdd * 100,
    maxDrawdownFrom: mddFrom,
    maxDrawdownTo: mddTo,
    annualVolPct: isNum(annVol) ? annVol * 100 : null,
    sharpe: isNum(annVol) && annVol > 0.005 && isNum(annualized) ? (annualized / 100 - input.fixedIncomeYield) / annVol : null,
    trades: trades.length,
    closedTrades: sells.length,
    winRatePct: sells.length ? (wins.length / sells.length) * 100 : null,
    avgWinPct: wins.length ? mean(wins.map((t) => t.realizedPct!)) : null,
    avgLossPct: losses.length ? mean(losses.map((t) => t.realizedPct!)) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? null : null,
    feesToman: acct.feesToman,
    interestToman: acct.interestRial / 10,
    avgExposurePct: mean(x.exposures) * 100,
    stops: trades.filter((t) => t.kind === 'stop').length,
    newsDrivenTrades: trades.filter((t) => t.news.length).length,
  };

  const attribution: AssetAttribution[] = active.map((a) => {
    const p0 = x.priceStart(a), p1 = x.priceEnd(a);
    const p = pos.get(a);
    const unreal = p && p.qty > 0 && isNum(p1) ? (p.qty * p1 - p.cost) / 10 : 0;
    const s = x.series[a];
    return {
      asset: a, label: META[a].label,
      marketPct: isNum(p0) && isNum(p1) ? (p1 / p0 - 1) * 100 : null,
      realizedToman: p?.realized ?? 0, unrealizedToman: unreal, feesToman: p?.fees ?? 0,
      trades: trades.filter((t) => t.asset === a).length, daysHeld: p?.daysHeld ?? 0,
      basis: s?.basis ?? '', reconstructed: s?.reconstructed ?? false,
    };
  });

  const last = equity[equity.length - 1];
  const benchmarks: Benchmark[] = [
    { key: 'strategy', label: 'معامله‌گر شبیه‌سازی‌شده', finalToman: finalEquity, returnPct },
    { key: 'deposit', label: `سپرده/صندوق درآمد ثابت (${fmtPct(input.fixedIncomeYield * 100, 0, false)} سالانه)`, finalToman: last.deposit, returnPct: (last.deposit / input.capitalToman - 1) * 100 },
    ...(isNum(last.usdHold) ? [{ key: 'usd', label: 'خرید دلار و نگهداری', finalToman: last.usdHold, returnPct: (last.usdHold / input.capitalToman - 1) * 100 }] : []),
    ...(isNum(last.equal) ? [{ key: 'equal', label: 'تقسیم برابر بین دارایی‌های انتخابی', finalToman: last.equal, returnPct: (last.equal / input.capitalToman - 1) * 100 }] : []),
    ...attribution
      .filter((a) => a.asset !== 'usd' && isNum(a.marketPct))
      .map((a) => {
        const f = input.capitalToman * (1 - META[a.asset].cost) * (1 + a.marketPct! / 100);
        return { key: `hold-${a.asset}`, label: `خرید ${a.label} و نگهداری`, finalToman: f, returnPct: (f / input.capitalToman - 1) * 100 };
      }),
  ];

  const newsUsed = x.news.filter((n) => x.newsUse.has(n.id)).map((n) => ({ ...n, usedIn: x.newsUse.get(n.id)! }));
  return { input, metrics, trades, equity, benchmarks, attribution, newsUsed, analysis: [], warnings: x.warnings, paramsVersion: x.paramsVersion };
}

// ─────────────────────────── analysis ───────────────────────────

const toman = (v: number) => `${fmtInt(v)} تومان`;
const faDate = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

export function analyse(r: SimResult, newsAvailable: number, mode: 'backtest' | 'live' = 'backtest'): { title: string; body: string }[] {
  const m = r.metrics;
  const out: { title: string; body: string }[] = [];
  const best = [...r.benchmarks].filter((b) => b.key !== 'strategy').sort((a, b) => b.returnPct - a.returnPct)[0];
  const dep = r.benchmarks.find((b) => b.key === 'deposit')!;
  const beatDeposit = m.returnPct > dep.returnPct;

  out.push({
    title: 'نتیجه کلی',
    body:
      `از ${faDate(r.input.start)} تا ${faDate(r.input.end)} (${fmtInt(m.days)} روز)، سرمایه ${toman(m.startEquity)} به ${toman(m.finalEquity)} رسید؛ ` +
      `${m.pnlToman >= 0 ? 'سود' : 'زیان'} ${toman(Math.abs(m.pnlToman))} معادل ${fmtPct(m.returnPct, 1)}` +
      `${isNum(m.annualizedPct) ? ` (سالانه‌شده ${fmtPct(m.annualizedPct, 0)})` : ''}. ` +
      `${beatDeposit ? `این نتیجه از سپرده بدون ریسک (${fmtPct(dep.returnPct, 1)}) بهتر بود` : `این نتیجه از سپرده بدون ریسک (${fmtPct(dep.returnPct, 1)}) ضعیف‌تر بود، یعنی ریسک‌پذیری در این بازه جبران نشد`}` +
      `${best ? `؛ بهترین گزینه منفعل «${best.label}» با ${fmtPct(best.returnPct, 1)} بود.` : '.'}` +
      `${isNum(m.usdReturnPct) ? ` بازده به دلار ${fmtPct(m.usdReturnPct, 1)} بود؛ ${m.usdReturnPct >= 0 ? 'قدرت خرید دلاری سرمایه حفظ یا بیشتر شد' : 'یعنی با وجود رقم تومانی، قدرت خرید دلاری سرمایه کم شد'}.` : ''}`,
  });

  const moves = r.attribution.filter((a) => isNum(a.marketPct)).sort((a, b) => b.marketPct! - a.marketPct!);
  if (moves.length) {
    out.push({
      title: 'بازار در این بازه چه کرد',
      body: `تغییر قیمت از ابتدا تا انتهای بازه: ${moves.map((a) => `${a.label} ${fmtPct(a.marketPct, 1)}`).join('، ')}. ` +
        (moves[0].marketPct! - moves[moves.length - 1].marketPct! > 20 ? 'فاصله زیاد بازده دارایی‌ها نشان می‌دهد انتخاب دارایی از زمان‌بندی مهم‌تر بود.' : 'بازده دارایی‌ها به هم نزدیک بود؛ در چنین بازاری هزینه معاملات و زمان‌بندی سهم بیشتری از نتیجه دارند.'),
    });
  }

  const byPnl = [...r.attribution].map((a) => ({ ...a, total: a.realizedToman + a.unrealizedToman })).sort((a, b) => b.total - a.total);
  const winners = byPnl.filter((a) => a.total > 0);
  const losers = byPnl.filter((a) => a.total < 0);
  const firstEntry = (asset: SimAsset) => r.trades.find((t) => t.asset === asset && t.side === 'buy');
  if (winners.length) {
    const w = winners[0];
    const e = firstEntry(w.asset);
    out.push({
      title: 'چه چیزی جواب داد',
      body: `بیشترین سود از ${w.label} آمد (${toman(w.total)}). ${e ? `اولین ورود در ${faDate(e.date)} بود با این منطق: ${e.reasons.slice(0, 2).join('؛ ')}.` : ''}` +
        (winners.length > 1 ? ` پس از آن ${winners.slice(1, 3).map((x) => `${x.label} (${toman(x.total)})`).join(' و ')}.` : ''),
    });
  }
  if (losers.length || m.stops) {
    const whipsaws = r.trades.filter((t) => t.side === 'sell' && isNum(t.holdDays) && t.holdDays! <= 21 && (t.realizedToman ?? 0) < 0).length;
    out.push({
      title: 'چه چیزی ضرر داد',
      body:
        (losers.length ? `بیشترین زیان در ${losers[losers.length - 1].label} بود (${toman(losers[losers.length - 1].total)}). ` : '') +
        (m.stops ? `${fmtInt(m.stops)} بار حد ضرر فعال شد. ` : '') +
        (whipsaws ? `${fmtInt(whipsaws)} معامله در کمتر از سه هفته با زیان بسته شد؛ نشانه بازار بی‌روند و نوسانی که سیگنال‌های روند در آن گمراه‌کننده‌اند. ` : '') +
        `مجموع کارمزد و اختلاف خرید و فروش ${toman(m.feesToman)} شد.`,
    });
  }

  out.push({
    title: 'ریسک',
    body:
      `بیشترین افت سرمایه ${fmtPct(m.maxDrawdownPct, 1)} بود${m.maxDrawdownFrom && m.maxDrawdownTo ? ` (از ${faDate(m.maxDrawdownFrom)} تا ${faDate(m.maxDrawdownTo)})` : ''}. ` +
      `به‌طور میانگین ${fmtPct(m.avgExposurePct, 0, false)} سرمایه درگیر بازار بود و بقیه در درآمد ثابت ماند که ${toman(m.interestToman)} سود ساخت. ` +
      (isNum(m.winRatePct) ? `از ${fmtInt(m.closedTrades)} فروش، ${fmtPct(m.winRatePct, 0, false)} با سود بسته شد${isNum(m.avgWinPct) && isNum(m.avgLossPct) ? `؛ میانگین سود ${fmtPct(m.avgWinPct, 1)} و میانگین زیان ${fmtPct(m.avgLossPct, 1)}` : ''}.` : 'هیچ موقعیتی بسته نشد.'),
  });

  if (newsAvailable > 0) {
    const newsTrades = r.trades.filter((t) => t.news.length);
    const closedNews = newsTrades.filter((t) => t.side === 'sell' && isNum(t.realizedToman));
    const topFacts = new Map<string, number>();
    for (const n of r.newsUsed) for (const f of n.facts) topFacts.set(f, (topFacts.get(f) ?? 0) + n.usedIn.length);
    const facts = [...topFacts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);
    const shockTrades = r.trades.filter((t) => t.reasons[0]?.startsWith('بازبینی فوری'));
    out.push({
      title: 'نقش اخبار',
      body:
        (`${fmtInt(newsAvailable)} خبر مرتبط با اثر قابل‌تشخیص در این بازه خوانده شد. ` +
        (newsTrades.length
          ? `اخبار در ${fmtInt(newsTrades.length)} تصمیم از ${fmtInt(r.trades.length)} تصمیم نقش داشت${facts.length ? `؛ پرتکرارترین موضوع‌ها: ${facts.join('، ')}` : ''}. ` +
            (shockTrades.length ? `${fmtInt(shockTrades.length)} معامله با بازبینی فوری پس از یک خبر مهم انجام شد. ` : '') +
            (closedNews.length ? `فروش‌هایی که خبر در آن‌ها اثر داشت در مجموع ${toman(closedNews.reduce((s, t) => s + t.realizedToman!, 0))} نتیجه دادند.` : '')
          : 'اثر خبرها آن‌قدر قوی نبود که به‌تنهایی تصمیمی را تغییر دهد؛ تصمیم‌ها عمدتاً بر پایه روند قیمت بودند.')).trim(),
    });
  }

  out.push({
    title: 'برداشت و محدودیت‌ها',
    body:
      (beatDeposit ? 'قاعده‌های روند و حد ضرر در این بازه ارزش افزوده داشتند، اما یک بازه تاریخی تضمینی برای تکرار نیست. ' : 'در این بازه نگهداری ساده یا درآمد ثابت بهتر بود؛ معامله‌گری فعال همیشه برتری ندارد، به‌خصوص با کارمزد و اسپرد بازار ایران. ') +
      (mode === 'live'
        ? 'معاملات روی قیمت‌های زنده همان لحظه با احتساب اسپرد انجام شد، اما پول واقعی جابه‌جا نشد؛ در بازار واقعی قیمت اجرا، نقدشوندگی و صف می‌تواند متفاوت باشد. موقعیت‌های باز در پایان با قیمت روز ارزش‌گذاری شده‌اند، نه فروخته. '
        : 'تصمیم‌ها فقط با داده و خبری گرفته شده که تا همان روز منتشر شده بود و سفارش‌ها در قیمت پایانی جلسه بعد اجرا شده‌اند. ') +
      'تحلیل خبر با قاعده‌های کلیدواژه‌ای است و طعنه، تکذیب یا خبرهای غیرتیتری را درک نمی‌کند. این شبیه‌سازی توصیه سرمایه‌گذاری نیست.',
  });
  return out;
}
