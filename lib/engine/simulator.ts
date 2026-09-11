// Simulated discretionary-style swing trader for Iranian markets.
// Pure function: no I/O. Everything it "knows" on day t comes from prices dated ≤ t and news published before that day's decision cutoff.
// Orders are decided at a session close and filled at the NEXT available close of that asset, with spread/fee costs.
import { clamp, fmtInt, fmtPct, isNum } from '@/lib/num';
import { ewmaVol, logReturns, mean, rsi, sma, std } from './stats';

export type SimAsset = 'usd' | 'g18' | 'coin' | 'tse' | 'btc' | 'eth';
export type SimProfile = 'conservative' | 'balanced' | 'aggressive';

export const SIM_ASSETS: { key: SimAsset; label: string; unit: string; crypto: boolean; cost: number; costNote: string }[] = [
  { key: 'usd', label: 'دلار', unit: 'دلار', crypto: false, cost: 0.006, costNote: 'اختلاف خرید و فروش صرافی حدود ۱٫۲٪ رفت‌وبرگشت' },
  { key: 'g18', label: 'طلای ۱۸ عیار', unit: 'گرم', crypto: false, cost: 0.008, costNote: 'طلای آب‌شده؛ اختلاف خرید و فروش حدود ۱٫۶٪، بدون اجرت' },
  { key: 'coin', label: 'سکه امامی', unit: 'سکه', crypto: false, cost: 0.006, costNote: 'اختلاف خرید و فروش حدود ۱٫۲٪؛ مقدار کسری یعنی معادل گواهی سپرده سکه' },
  { key: 'tse', label: 'صندوق شاخصی بورس', unit: 'واحد', crypto: false, cost: 0.005, costNote: 'کارمزد صندوق ETF به‌علاوه خطای ردیابی شاخص، حدود ۰٫۵٪ هر طرف' },
  { key: 'btc', label: 'بیت‌کوین', unit: 'BTC', crypto: true, cost: 0.004, costNote: 'کارمزد صرافی داخلی و اسپرد تتر، حدود ۰٫۴٪ هر طرف' },
  { key: 'eth', label: 'اتریوم', unit: 'ETH', crypto: true, cost: 0.004, costNote: 'کارمزد صرافی داخلی و اسپرد تتر، حدود ۰٫۴٪ هر طرف' },
];
const META = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<SimAsset, (typeof SIM_ASSETS)[number]>;

export const PROFILES: Record<SimProfile, { label: string; maxW: number; cryptoCap: number; cashFloor: number; targetVol: number; entry: number; exit: number; stopK: number; minStop: number; band: number }> = {
  conservative: { label: 'محتاط', maxW: 0.25, cryptoCap: 0.06, cashFloor: 0.3, targetVol: 0.14, entry: 40, exit: 5, stopK: 2.2, minStop: 0.04, band: 0.05 },
  balanced: { label: 'متعادل', maxW: 0.35, cryptoCap: 0.2, cashFloor: 0.1, targetVol: 0.22, entry: 30, exit: -2, stopK: 2.6, minStop: 0.05, band: 0.05 },
  aggressive: { label: 'جسور', maxW: 0.5, cryptoCap: 0.4, cashFloor: 0, targetVol: 0.35, entry: 22, exit: -10, stopK: 3.0, minStop: 0.07, band: 0.06 },
};

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
}

// ─────────────────────────── helpers ───────────────────────────

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
/** decisions happen after the Tehran close (~16:00 = 12:30 UTC); only news published before that is visible */
const cutoffMs = (date: string) => Date.parse(`${date}T12:30:00Z`);

class PriceBook {
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

interface Signal {
  score: number;
  newsScore: number;
  annVol: number;
  rsi: number | null;
  reasonsUp: string[];
  reasonsDown: string[];
  news: NewsRef[];
  ppy: number;
}

interface Position {
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

interface Order {
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

function signalFor(asset: SimAsset, book: PriceBook, date: string, input: SimInput, bubbleBooks: { ons?: PriceBook; usd?: PriceBook }): Signal | null {
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
  let score = 0;

  // 1) trend structure
  if (s20 > s50) {
    score += 15;
    up.push('میانگین ۲۰ روزه بالای میانگین ۵۰ روزه است (روند صعودی)');
  } else {
    score -= 15;
    down.push('میانگین ۲۰ روزه زیر میانگین ۵۰ روزه است (روند نزولی)');
  }
  if (last > s50) {
    score += 15;
    up.push(`قیمت ${pctTxt(last / s50 - 1, 1)} بالاتر از میانگین ۵۰ روزه`);
  } else {
    score -= 15;
    down.push(`قیمت ${pctTxt(last / s50 - 1, 1)} نسبت به میانگین ۵۰ روزه`);
  }

  // 2) risk-adjusted momentum
  const z60 = Math.log(1 + ret60) / (annVol * Math.sqrt(60 / ppy));
  const m60 = 25 * Math.tanh(z60 / 1.5);
  score += m60;
  (m60 >= 0 ? up : down).push(`بازده ۶۰ جلسه اخیر ${pctTxt(ret60, 1)}`);
  const z20 = Math.log(1 + ret20) / (annVol * Math.sqrt(20 / ppy));
  score += 10 * Math.tanh(z20 / 1.5);

  // 3) stretch / pullback
  if (isNum(R)) {
    if (R > 76) {
      score -= 15;
      down.push(`RSI برابر ${fmtInt(R)}؛ اشباع خرید و خطر اصلاح`);
    } else if (R > 68) {
      score -= 6;
      down.push(`RSI برابر ${fmtInt(R)}؛ نزدیک اشباع خرید`);
    } else if (R < 30 && s20 > s50) {
      score += 8;
      up.push(`RSI برابر ${fmtInt(R)}؛ پولبک در دل روند صعودی`);
    }
  }
  const hi60 = Math.max(...p.slice(-60));
  if (last < hi60 * 0.85 && s20 < s50) {
    score -= 10;
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
        down.push(`حباب سکه ${pctAbs(now, 0)}، بالاتر از میانگین سه ماه اخیر (${pctAbs(norm, 0)})`);
      } else if (now > 0.25) {
        score -= 8;
        down.push(`حباب سکه ${pctAbs(now, 0)}؛ گران نسبت به طلای خام`);
      } else if (norm - now > 0.04) {
        score += 6;
        up.push(`حباب سکه ${pctAbs(now, 0)}، کمتر از میانگین سه ماه اخیر`);
      }
    }
  }

  // 5) news — only items published before this session's decision cutoff, decaying over ~4 days
  let newsSum = 0;
  const refs: (NewsRef & { contrib: number })[] = [];
  const cut = cutoffMs(date);
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
  const newsScore = 20 * Math.tanh(newsSum / 1.6);
  score += newsScore;
  const topNews = refs.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 3);
  if (Math.abs(newsScore) >= 3) {
    const facts = [...new Set(topNews.filter((n) => Math.sign(n.contrib) === Math.sign(newsScore)).flatMap((n) => n.facts))].slice(0, 2);
    (newsScore > 0 ? up : down).push(`جمع‌بندی اخبار ۱۰ روز اخیر ${newsScore > 0 ? 'مثبت' : 'منفی'} است: ${facts.join('، ')}`);
  }

  return { score: clamp(score, -100, 100), newsScore, annVol, rsi: R, reasonsUp: up, reasonsDown: down, news: topNews.map(({ contrib: _c, ...n }) => n), ppy };
}

// ─────────────────────────── simulation ───────────────────────────

export function simulate(input: SimInput): SimResult {
  const prof = PROFILES[input.profile];
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
  let cash = capitalRial;
  let interest = 0;
  let fees = 0;
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
  const totalEquity = (d: string) => cash + active.reduce((s, a) => s + valueOf(a, d), 0);

  // benchmarks
  const usdBook = bubbleBooks.usd ?? books.get('usd');
  const startUsd = usdBook?.priceAt(calendar[0]) ?? null;
  const eqStartPrices = new Map(active.map((a) => [a, books.get(a)!.priceAt(calendar[0])]));

  let prevDate = calendar[0];
  let nextReview = calendar[0];
  let lastReview: string | null = null;

  /** A headline counts as a shock only if it is a fundamental event (not a price report), hits an asset hard,
   *  its theme was not already in the news during the previous 5 days, and the book was not reviewed in the last 3 days. */
  function findShock(date: string): { news: ScoredNews; assets: SimAsset[] } | null {
    if (lastReview && daysBetween(lastReview, date) < 3) return null;
    const cut = cutoffMs(date);
    const from = addDays(date, -5);
    for (const n of input.news) {
      if (n.date !== date || n.ms > cut || n.weight < 0.8) continue;
      const hit = active.filter((a) => Math.abs(n.effects[a] ?? 0) >= 0.6);
      if (!hit.length) continue;
      const stale = input.news.some((m) => m.id !== n.id && m.ms < n.ms && m.date >= from && m.facts.some((f) => n.facts.includes(f)));
      if (!stale) return { news: n, assets: hit };
    }
    return null;
  }

  for (const date of calendar) {
    // 1) interest on idle cash (calendar days since previous session)
    const gap = Math.max(0, daysBetween(prevDate, date));
    if (gap > 0) {
      const inc = cash * (Math.pow(1 + dailyYield, gap) - 1);
      cash += inc;
      interest += inc;
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
      const mkt = book.priceAt(date)!;
      const cost = META[o.asset].cost;
      const eqNow = totalEquity(date);
      if (o.side === 'buy') {
        const budget = Math.min(o.valueRial ?? 0, cash);
        if (budget < eqNow * 0.01) continue;
        const fill = mkt * (1 + cost);
        const qty = budget / fill;
        const fee = budget - qty * mkt;
        cash -= budget;
        fees += fee / 10;
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
        record(o, date, qty, fill, budget, fee, null, null, null);
      } else {
        const p = pos.get(o.asset);
        if (!p || p.qty <= 0) continue;
        const qty = p.qty * clamp(o.qtyFraction ?? 1, 0, 1);
        const fill = mkt * (1 - cost);
        const proceeds = qty * fill;
        const fee = qty * mkt - proceeds;
        const costPart = p.cost * (qty / p.qty);
        const realized = (proceeds - costPart) / 10;
        cash += proceeds;
        fees += fee / 10;
        p.qty -= qty;
        p.cost -= costPart;
        p.realized += realized;
        p.fees += fee / 10;
        p.trades++;
        const hold = daysBetween(p.entryDate, date);
        if (p.qty <= 1e-12) {
          p.qty = 0;
          p.cost = 0;
          if (o.kind === 'stop') cooldown.set(o.asset, addDays(date, 10));
        }
        record(o, date, qty, fill, proceeds, fee, realized, (proceeds / costPart - 1) * 100, hold);
      }
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
      const sig = signalFor(a, book, date, input, bubbleBooks);
      if (px <= p.peak * (1 - p.stopDist)) {
        pending.push({
          asset: a, side: 'sell', kind: 'stop', decisionDate: date, qtyFraction: 1, targetW: 0,
          signal: sig ?? lastSignal.get(a)!,
          reasons: [`حد ضرر متحرک فعال شد: قیمت ${pctTxt(px / p.peak - 1, 1)} از بالاترین قیمت پس از خرید پایین آمد (فاصله مجاز ${pctAbs(p.stopDist, 1)})`, 'خروج کامل بدون توجه به دیدگاه قبلی؛ ۱۰ روز ورود دوباره ممنوع'],
        });
      } else if (!p.tookProfit && sig && px >= p.entryPrice * (1 + 3 * p.stopDist) && isNum(sig.rsi) && sig.rsi > 72) {
        pending.push({
          asset: a, side: 'sell', kind: 'take_profit', decisionDate: date, qtyFraction: 1 / 3, targetW: 0,
          signal: sig,
          reasons: [`قیمت ${pctTxt(px / p.entryPrice - 1, 1)} بالاتر از قیمت ورود است (سه برابر فاصله حد ضرر)`, `RSI برابر ${fmtInt(sig.rsi)}؛ برداشت یک‌سوم سود و ادامه با باقی موقعیت`],
        });
        p.tookProfit = true;
      }
    }

    // 4) weekly review; plus an immediate review limited to the affected assets when a NEW high-impact event breaks
    if (date >= nextReview) {
      review(date, null);
      nextReview = addDays(date, 7);
      lastReview = date;
    } else {
      const shock = findShock(date);
      if (shock) {
        review(date, shock);
        lastReview = date;
      }
    }

    const eq = totalEquity(date);
    const invested = eq - cash;
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
      cash: cash / 10,
      invested: invested / 10,
      deposit: input.capitalToman * Math.pow(1 + input.fixedIncomeYield, daysBetween(calendar[0], date) / 365),
      usdHold: isNum(startUsd) && isNum(usdNow) ? input.capitalToman * (1 - META.usd.cost) * (usdNow / startUsd) : null,
      equal,
      equityUsd: isNum(usdNow) ? eq / usdNow : null,
    });
  }

  function review(date: string, shock: { news: ScoredNews; assets: SimAsset[] } | null) {
    const eq = totalEquity(date);
    const sigs = new Map<SimAsset, Signal>();
    for (const a of active) {
      const s = signalFor(a, books.get(a)!, date, input, bubbleBooks);
      if (s) {
        sigs.set(a, s);
        lastSignal.set(a, s);
      }
    }
    // raw targets
    const target = new Map<SimAsset, number>();
    for (const [a, s] of sigs) {
      const held = (pos.get(a)?.qty ?? 0) > 0;
      const curW = valueOf(a, date) / eq;
      if (s.score >= prof.entry && !(cooldown.get(a) && date < cooldown.get(a)!)) {
        const conviction = (s.score - prof.entry) / (100 - prof.entry);
        const volScale = Math.min(1, prof.targetVol / Math.max(s.annVol, 0.02));
        target.set(a, prof.maxW * (0.45 + 0.55 * conviction) * volScale);
      } else if (held && s.score > prof.exit) target.set(a, Math.min(curW, prof.maxW * 1.15));
      else target.set(a, 0);
    }
    // portfolio limits: crypto cap, then total ≤ 1 − cash floor
    const cryptoSum = [...target].filter(([a]) => META[a].crypto).reduce((s, [, w]) => s + w, 0);
    if (cryptoSum > prof.cryptoCap) for (const [a, w] of target) if (META[a].crypto) target.set(a, (w * prof.cryptoCap) / cryptoSum);
    const tot = [...target.values()].reduce((s, w) => s + w, 0);
    if (tot > 1 - prof.cashFloor) for (const [a, w] of target) target.set(a, (w * (1 - prof.cashFloor)) / tot);

    const prefix = shock ? `بازبینی فوری پس از خبر «${shock.news.title.slice(0, 90)}» (${shock.news.source})` : null;
    // sells first so that cash is available for buys filled on the same session
    const order = [...target.keys()].sort((x, y) => (target.get(x)! - valueOf(x, date) / eq) - (target.get(y)! - valueOf(y, date) / eq));
    for (const a of order) {
      if (pending.some((o) => o.asset === a)) continue;
      if (shock && !shock.assets.includes(a)) continue; // an event review only touches the assets the event is about
      const s = sigs.get(a)!;
      const p = pos.get(a);
      const held = !!p && p.qty > 0;
      const curW = valueOf(a, date) / eq;
      const tw = target.get(a)!;
      const diff = tw - curW;
      const why = (list: string[]) => [...(prefix ? [prefix] : []), ...list];
      if (held && tw === 0) {
        if (daysBetween(p!.lastBuy, date) < 5 && s.score > prof.exit - 15) continue; // minimum holding period unless the picture collapsed
        pending.push({ asset: a, side: 'sell', kind: 'exit', decisionDate: date, qtyFraction: 1, targetW: 0, signal: s,
          reasons: why([`امتیاز ${fmtInt(s.score)} به زیر آستانه خروج (${fmtInt(prof.exit)}) رسید`, ...s.reasonsDown.slice(0, 3)]) });
      } else if (held && diff < -prof.band) {
        pending.push({ asset: a, side: 'sell', kind: 'trim', decisionDate: date, qtyFraction: clamp(-diff / curW, 0, 1), targetW: tw, signal: s,
          reasons: why([`کاهش وزن از ${pctAbs(curW)} به ${pctAbs(tw)} سبد`, ...(s.reasonsDown.length ? s.reasonsDown.slice(0, 2) : ['رشد قیمت وزن این دارایی را از سقف مجاز پروفایل بالاتر برده است'])]) });
      } else if (diff > prof.band || (!held && tw >= 0.03 && diff > 0.03)) {
        pending.push({ asset: a, side: 'buy', kind: held ? 'add' : 'entry', decisionDate: date, valueRial: diff * eq, targetW: tw, signal: s,
          reasons: why([
            `امتیاز ${fmtInt(s.score)} از آستانه ورود (${fmtInt(prof.entry)}) بالاتر است؛ وزن هدف ${pctAbs(tw)} سبد`,
            ...s.reasonsUp.slice(0, 3),
            `نوسان سالانه ${pctAbs(s.annVol)}؛ اندازه موقعیت با هدف نوسان ${pctAbs(prof.targetVol)} تنظیم شد`,
            ...(s.reasonsDown.length ? [`ریسک در نظر گرفته‌شده: ${s.reasonsDown[0]}`] : []),
          ]) });
      }
    }
  }

  function record(o: Order, date: string, qty: number, fill: number, valueRial: number, feeRial: number, realized: number | null, realizedPct: number | null, hold: number | null) {
    const eq = totalEquity(date);
    const n = trades.length + 1;
    const useNews = Math.abs(o.signal.newsScore) >= 3 || o.reasons.some((r) => r.startsWith('بازبینی فوری'));
    const news = useNews ? o.signal.news : [];
    for (const ref of news) newsUse.set(ref.id, [...(newsUse.get(ref.id) ?? []), n]);
    trades.push({
      n, decisionDate: o.decisionDate, date, asset: o.asset, side: o.side, kind: o.kind, qty, price: fill,
      valueToman: valueRial / 10, feeToman: feeRial / 10, realizedToman: realized, realizedPct, holdDays: hold,
      score: Math.round(o.signal.score), newsScore: Math.round(o.signal.newsScore), weightAfter: eq > 0 ? valueOf(o.asset, date) / eq : 0,
      reasons: o.reasons, news,
    });
  }

  // ─── metrics ───
  const lastDate = calendar[calendar.length - 1];
  const eqSeries = equity.map((e) => e.equity);
  const finalEquity = eqSeries[eqSeries.length - 1];
  const days = Math.max(1, daysBetween(calendar[0], lastDate));
  let peak = -Infinity, mdd = 0, peakDate = calendar[0], mddFrom: string | null = null, mddTo: string | null = null;
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
  const usdReturnPct = isNum(firstEqUsd) && isNum(lastEqUsd) && isNum(startUsd) ? (lastEqUsd / (capitalRial / startUsd) - 1) * 100 : null;

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
    feesToman: fees,
    interestToman: interest / 10,
    avgExposurePct: mean(exposures) * 100,
    stops: trades.filter((t) => t.kind === 'stop').length,
    newsDrivenTrades: trades.filter((t) => t.news.length).length,
  };

  const attribution: AssetAttribution[] = active.map((a) => {
    const book = books.get(a)!;
    const p0 = book.priceAt(calendar[0]), p1 = book.priceAt(lastDate);
    const p = pos.get(a);
    const unreal = p && p.qty > 0 ? (p.qty * p1! - p.cost) / 10 : 0;
    const s = input.series[a]!;
    return {
      asset: a, label: META[a].label,
      marketPct: isNum(p0) && isNum(p1) ? (p1 / p0 - 1) * 100 : null,
      realizedToman: p?.realized ?? 0, unrealizedToman: unreal, feesToman: p?.fees ?? 0,
      trades: trades.filter((t) => t.asset === a).length, daysHeld: p?.daysHeld ?? 0,
      basis: s.basis, reconstructed: s.reconstructed,
    };
  });

  const last = equity[equity.length - 1];
  const benchmarks: Benchmark[] = [
    { key: 'strategy', label: 'معامله‌گر شبیه‌سازی‌شده', finalToman: finalEquity, returnPct },
    { key: 'deposit', label: `سپرده/صندوق درآمد ثابت (${fmtPct(input.fixedIncomeYield * 100, 0, false)} سالانه)`, finalToman: last.deposit, returnPct: (last.deposit / input.capitalToman - 1) * 100 },
    ...(isNum(last.usdHold) ? [{ key: 'usd', label: 'خرید دلار و نگهداری', finalToman: last.usdHold, returnPct: (last.usdHold / input.capitalToman - 1) * 100 }] : []),
    ...(isNum(last.equal) ? [{ key: 'equal', label: 'تقسیم برابر بین دارایی‌های انتخابی', finalToman: last.equal, returnPct: (last.equal / input.capitalToman - 1) * 100 }] : []),
    ...attribution
      .filter((x) => x.asset !== 'usd' && isNum(x.marketPct))
      .map((x) => {
        const f = input.capitalToman * (1 - META[x.asset].cost) * (1 + x.marketPct! / 100);
        return { key: `hold-${x.asset}`, label: `خرید ${x.label} و نگهداری`, finalToman: f, returnPct: (f / input.capitalToman - 1) * 100 };
      }),
  ];

  const newsUsed = input.news.filter((n) => newsUse.has(n.id)).map((n) => ({ ...n, usedIn: newsUse.get(n.id)! }));
  const result: SimResult = {
    input: { start: calendar[0], end: lastDate, capitalToman: input.capitalToman, profile: input.profile, assets: active, fixedIncomeYield: input.fixedIncomeYield },
    metrics, trades, equity, benchmarks, attribution, newsUsed, analysis: [], warnings,
  };
  result.analysis = analyse(result, input.news.length);
  return result;
}

// ─────────────────────────── analysis ───────────────────────────

const toman = (v: number) => `${fmtInt(v)} تومان`;
const faDate = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

export function analyse(r: SimResult, newsAvailable: number): { title: string; body: string }[] {
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
      'تصمیم‌ها فقط با داده و خبری گرفته شده که تا همان روز منتشر شده بود و سفارش‌ها در قیمت پایانی جلسه بعد اجرا شده‌اند. تحلیل خبر با قاعده‌های کلیدواژه‌ای است و طعنه، تکذیب یا خبرهای غیرتیتری را درک نمی‌کند. این شبیه‌سازی توصیه سرمایه‌گذاری نیست.',
  });
  return out;
}
