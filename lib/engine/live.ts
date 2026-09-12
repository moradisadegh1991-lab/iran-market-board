// Live paper trading ("معامله برخط"): the backtest rules applied tick by tick to real-time quotes.
// Pure — the caller supplies quotes, daily history and news, and persists the JSON session.
// Differences from the backtest, by design:
//  • orders fill immediately at the live quote ± spread when that market is open; otherwise they wait for it to open
//  • stops / take-profit are checked on every tick (every few minutes), not once a day
import { isNum, tehranClock, tehranDate } from '@/lib/num';
import { mean } from './stats';
import {
  PriceBook, SIM_ASSETS, analyse, buildResult, checkExit, effectiveProfile, executeOrder, findShockIn, planReview, signalFor, tradeRecord,
  type Account, type EquityPoint, type Order, type Position, type ScoredNews, type Signal, type SimAsset, type SimParams, type SimProfile, type SimResult, type SimTrade,
} from './simulator';

const DAY = 86400000;
const META = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<SimAsset, (typeof SIM_ASSETS)[number]>;
const MAX_EVENTS = 150;
/** used only so a stop can still fire if the asset's history became unavailable mid-session */
const NEUTRAL_SIGNAL: Signal = { score: 0, newsScore: 0, components: { trend: 0, momentum: 0, stretch: 0, bubble: 0, news: 0 }, annVol: 0.2, rsi: null, reasonsUp: [], reasonsDown: [], news: [], ppy: 300 };

export interface LiveConfig {
  capitalToman: number;
  profile: SimProfile;
  assets: SimAsset[];
  days: number;
  reviewEveryDays: number; // 7 = same rhythm as the backtest, 1 = daily
  fixedIncomeYield: number;
  useNews: boolean;
}

export type LiveTrade = SimTrade & { at: number; equityToman: number; returnPct: number };
export type LiveEquityPoint = EquityPoint & { at: number };
export type LiveOrder = Order & { createdAt: number };

export interface LiveEvent {
  at: number;
  kind: 'start' | 'review' | 'shock' | 'queued' | 'dropped' | 'gap' | 'data' | 'finish';
  text: string;
}

export interface LiveSession {
  id: string;
  status: 'running' | 'finished';
  startedAt: number;
  endsAt: number;
  finishedAt: number | null;
  endReason: 'expired' | 'stopped' | null;
  config: LiveConfig;
  params: SimParams; // frozen at start so a session is one consistent strategy
  acct: Account;
  positions: Partial<Record<SimAsset, Position>>;
  cooldown: Partial<Record<SimAsset, string>>;
  pending: LiveOrder[];
  trades: LiveTrade[];
  equity: LiveEquityPoint[];
  exposures: number[];
  startQuotes: Partial<Record<SimAsset, number>>;
  startUsd: number | null;
  lastQuotes: Partial<Record<SimAsset, { price: number; at: number }>>;
  lastTickAt: number;
  lastReviewAt: number | null;
  lastReviewDate: string | null;
  lastDay: string | null;
  ticks: number;
  events: LiveEvent[];
  newsUse: Record<string, number[]>;
  newsSeen: ScoredNews[];
  result: SimResult | null;
}

export interface TickContext {
  now: number;
  quotes: Partial<Record<SimAsset, number>>; // rial per unit, live
  usdRial: number | null;
  daily: Partial<Record<SimAsset, { dates: string[]; prices: number[] }>>; // closes before today
  ons?: { dates: string[]; prices: number[] };
  usdRef?: { dates: string[]; prices: number[] };
  news: ScoredNews[];
}

export interface TickOutcome {
  newTrades: LiveTrade[];
  newEvents: LiveEvent[];
  finished: boolean;
}

/** When a paper order may fill. Crypto trades around the clock; the Iranian free market and TSE keep office hours (Tehran time). */
export function marketOpen(asset: SimAsset, now: number): boolean {
  if (META[asset].crypto) return true;
  const { weekday, minutes } = tehranClock(new Date(now));
  if (asset === 'tse') return (weekday === 6 || weekday <= 3) && minutes >= 9 * 60 && minutes <= 12 * 60 + 30;
  if (weekday === 5) return false; // Friday
  if (weekday === 4) return minutes >= 10 * 60 && minutes <= 14 * 60; // Thursday half day
  return minutes >= 10 * 60 && minutes <= 19 * 60;
}

export const MARKET_HOURS_NOTE = 'کریپتو ۲۴ ساعته؛ دلار، طلا و سکه شنبه تا چهارشنبه ۱۰ تا ۱۹ و پنجشنبه ۱۰ تا ۱۴؛ صندوق شاخصی بورس شنبه تا چهارشنبه ۹ تا ۱۲:۳۰ (به وقت تهران).';

export function createSession(id: string, config: LiveConfig, params: SimParams, now: number): LiveSession {
  return {
    id, status: 'running', startedAt: now, endsAt: now + config.days * DAY, finishedAt: null, endReason: null, config, params,
    acct: { cash: config.capitalToman * 10, interestRial: 0, feesToman: 0 },
    positions: {}, cooldown: {}, pending: [], trades: [], equity: [], exposures: [], startQuotes: {}, startUsd: null, lastQuotes: {},
    lastTickAt: now, lastReviewAt: null, lastReviewDate: null, lastDay: null, ticks: 0,
    events: [], newsUse: {}, newsSeen: [], result: null,
  };
}

export function liveTick(s: LiveSession, ctx: TickContext): TickOutcome {
  const newTrades: LiveTrade[] = [];
  const newEvents: LiveEvent[] = [];
  if (s.status !== 'running') return { newTrades, newEvents, finished: false };
  const now = ctx.now;
  const today = tehranDate(new Date(now));
  const cfg = s.config;
  const prof = effectiveProfile(cfg.profile, s.params);
  const event = (kind: LiveEvent['kind'], text: string) => {
    const e = { at: now, kind, text };
    s.events.unshift(e);
    newEvents.push(e);
  };

  const pos = new Map(Object.entries(s.positions) as [SimAsset, Position][]);
  const cooldown = new Map(Object.entries(s.cooldown) as [SimAsset, string][]);
  const newsUse = new Map(Object.entries(s.newsUse));

  // quotes
  for (const a of cfg.assets) {
    const q = ctx.quotes[a];
    if (isNum(q) && q > 0) {
      s.lastQuotes[a] = { price: q, at: now };
      if (!isNum(s.startQuotes[a])) s.startQuotes[a] = q;
    }
  }
  if (!isNum(s.startUsd) && isNum(ctx.usdRial)) s.startUsd = ctx.usdRial;
  const live = (a: SimAsset) => (isNum(ctx.quotes[a]) && ctx.quotes[a]! > 0 ? ctx.quotes[a]! : null);
  const mark = (a: SimAsset) => live(a) ?? s.lastQuotes[a]?.price ?? null;

  // daily books with today's live quote as the latest close
  const books = new Map<SimAsset, PriceBook>();
  for (const a of cfg.assets) {
    const d = ctx.daily[a];
    if (!d || d.dates.length < 62) continue;
    const dates = d.dates.filter((x) => x < today);
    const prices = d.prices.slice(0, dates.length);
    const q = mark(a);
    if (isNum(q)) {
      dates.push(today);
      prices.push(q);
    }
    books.set(a, new PriceBook(dates, prices));
  }
  const bubbleBooks = {
    ons: ctx.ons?.dates.length ? new PriceBook(ctx.ons.dates, ctx.ons.prices) : undefined,
    usd: ctx.usdRef?.dates.length ? new PriceBook(ctx.usdRef.dates, ctx.usdRef.prices) : undefined,
  };
  if (s.ticks === 0) {
    const missing = cfg.assets.filter((a) => !books.has(a));
    if (missing.length) event('data', `برای ${missing.map((a) => META[a].label).join('، ')} تاریخچه کافی (۶۲ روز) در دسترس نیست؛ این دارایی‌ها معامله نمی‌شوند.`);
  }

  // interest on idle cash
  const elapsed = Math.max(0, now - s.lastTickAt);
  if (elapsed > 0) {
    const inc = s.acct.cash * (Math.pow(1 + cfg.fixedIncomeYield, elapsed / DAY / 365) - 1);
    s.acct.cash += inc;
    s.acct.interestRial += inc;
  }
  if (s.ticks > 0 && elapsed > 45 * 60_000) event('gap', `فاصله این بررسی از قبلی ${Math.round(elapsed / 60_000).toLocaleString('fa-IR')} دقیقه بود؛ در این فاصله قیمت‌ها پایش نشدند.`);

  if (s.lastDay !== today) {
    for (const [a, p] of pos) if (p.qty > 0 && isNum(live(a))) p.daysHeld++;
    s.lastDay = today;
  }

  const valueOf = (a: SimAsset) => {
    const p = pos.get(a);
    if (!p || p.qty <= 0) return 0;
    return p.qty * (mark(a) ?? p.entryPrice);
  };
  const totalEquity = () => s.acct.cash + cfg.assets.reduce((sum, a) => sum + valueOf(a), 0);
  const signalCache = new Map<SimAsset, Signal | null>();
  const sig = (a: SimAsset) => {
    if (!signalCache.has(a)) {
      const b = books.get(a);
      signalCache.set(a, b ? signalFor(a, b, today, { news: ctx.news }, bubbleBooks, s.params, now) : null);
    }
    return signalCache.get(a)!;
  };

  const fillNow = (o: Order) => {
    const q = live(o.asset)!;
    const f = executeOrder(o, q, today, s.acct, pos, cooldown, prof, totalEquity());
    if (!f) return;
    const n = s.trades.length + 1;
    const rec = tradeRecord(o, n, today, f, totalEquity(), valueOf(o.asset), newsUse, s.params.version);
    for (const ref of rec.news) if (!s.newsSeen.some((x) => x.id === ref.id)) {
      const item = ctx.news.find((x) => x.id === ref.id);
      if (item) s.newsSeen.push(item);
    }
    const eq = totalEquity();
    const t: LiveTrade = { ...rec, at: now, equityToman: eq / 10, returnPct: (eq / 10 / cfg.capitalToman - 1) * 100 };
    s.trades.push(t);
    newTrades.push(t);
  };
  const canFill = (a: SimAsset) => marketOpen(a, now) && isNum(live(a));

  // 1) orders waiting for their market to open
  for (let i = 0; i < s.pending.length; ) {
    const o = s.pending[i];
    if (canFill(o.asset)) {
      s.pending.splice(i, 1);
      fillNow(o);
    } else if (now - o.createdAt > 4 * DAY) {
      s.pending.splice(i, 1);
      event('dropped', `سفارش ${o.side === 'buy' ? 'خرید' : 'فروش'} ${META[o.asset].label} پس از ۴ روز اجرا نشد و لغو شد.`);
    } else i++;
  }

  // 2) trailing stops and take-profit on every tick
  for (const a of cfg.assets) {
    const p = pos.get(a);
    const q = live(a);
    if (!p || p.qty <= 0 || !isNum(q) || !marketOpen(a, now)) continue;
    p.peak = Math.max(p.peak, q);
    if (s.pending.some((o) => o.asset === a && o.side === 'sell')) continue;
    const sg = sig(a);
    const exit = checkExit(a, p, q, sg, sg ?? NEUTRAL_SIGNAL, today, prof);
    if (exit) fillNow(exit);
  }

  // 3) scheduled review, or an event review when a new high-impact headline breaks
  const active = cfg.assets.filter((a) => books.has(a));
  const due = s.lastReviewAt === null || now - s.lastReviewAt >= cfg.reviewEveryDays * DAY - 20 * 60_000;
  const shock = !due && cfg.useNews ? findShockIn(ctx.news, active, today, s.lastReviewDate, now) : null;
  if ((due || shock) && active.length) {
    const eq = totalEquity();
    const sigs = new Map<SimAsset, Signal>();
    for (const a of active) {
      const sg = sig(a);
      if (sg) sigs.set(a, sg);
    }
    const orders = planReview({
      date: today, sigs, eq, prof, params: s.params, shock,
      weightOf: (a) => valueOf(a) / eq,
      position: (a) => pos.get(a),
      hasPending: (a) => s.pending.some((o) => o.asset === a),
      cooldownUntil: (a) => cooldown.get(a),
    });
    const before = newTrades.length;
    let queued = 0;
    for (const o of orders) {
      if (canFill(o.asset)) fillNow(o);
      else {
        s.pending.push({ ...o, createdAt: now });
        queued++;
      }
    }
    const done = newTrades.length - before;
    const scores = [...sigs].map(([a, g]) => `${META[a].label} ${Math.round(g.score).toLocaleString('fa-IR')}`).join('، ');
    event(shock ? 'shock' : 'review',
      `${shock ? `بازبینی فوری پس از خبر «${shock.news.title.slice(0, 80)}»` : 'بازبینی دوره‌ای'}: ` +
      (done || queued ? `${done.toLocaleString('fa-IR')} معامله انجام شد${queued ? `، ${queued.toLocaleString('fa-IR')} سفارش در انتظار باز شدن بازار` : ''}` : 'تغییری در سبد لازم نبود') +
      (scores ? `. امتیازها: ${scores}` : ''));
    if (queued) event('queued', `سفارش‌های در انتظار: ${s.pending.map((o) => `${o.side === 'buy' ? 'خرید' : 'فروش'} ${META[o.asset].label}`).join('، ')}. ${MARKET_HOURS_NOTE}`);
    s.lastReviewAt = now;
    s.lastReviewDate = today;
  }

  // 4) equity sample (hourly, and after every trade)
  const lastPt = s.equity[s.equity.length - 1];
  if (!lastPt || now - lastPt.at >= 55 * 60_000 || newTrades.length) pushEquity(s, now, today, totalEquity());

  s.positions = Object.fromEntries(pos);
  s.cooldown = Object.fromEntries(cooldown);
  s.newsUse = Object.fromEntries(newsUse);
  s.lastTickAt = now;
  s.ticks++;
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;

  if (now >= s.endsAt) {
    finishSession(s, 'expired', ctx);
    return { newTrades, newEvents, finished: true };
  }
  return { newTrades, newEvents, finished: false };
}

function pushEquity(s: LiveSession, now: number, today: string, eqRial: number) {
  const cfg = s.config;
  const mark = (a: SimAsset) => s.lastQuotes[a]?.price ?? null;
  const usdNow = mark('usd') ?? s.startUsd;
  const parts = cfg.assets
    .map((a) => {
      const p0 = s.startQuotes[a], p1 = mark(a);
      return isNum(p0) && isNum(p1) ? (p1 / p0) * (1 - META[a].cost) : null;
    })
    .filter(isNum);
  // rounded: hundreds of hourly samples are rewritten to Redis on every tick
  const r = Math.round;
  s.equity.push({
    at: now,
    date: today,
    equity: r(eqRial / 10),
    cash: r(s.acct.cash / 10),
    invested: r((eqRial - s.acct.cash) / 10),
    deposit: r(cfg.capitalToman * Math.pow(1 + cfg.fixedIncomeYield, (now - s.startedAt) / DAY / 365)),
    usdHold: isNum(s.startUsd) && isNum(usdNow) ? r(cfg.capitalToman * (1 - META.usd.cost) * (usdNow / s.startUsd)) : null,
    equal: parts.length ? r(cfg.capitalToman * mean(parts)) : null,
    equityUsd: isNum(usdNow) ? r((eqRial / usdNow) * 100) / 100 : null,
  });
  s.exposures.push(eqRial > 0 ? r(((eqRial - s.acct.cash) / eqRial) * 1000) / 1000 : 0);
}

/** Close the session (positions are marked to market, not sold) and build the same report as a backtest. */
export function finishSession(s: LiveSession, reason: 'expired' | 'stopped', ctx: Pick<TickContext, 'now'>): SimResult {
  const now = ctx.now;
  const today = tehranDate(new Date(now));
  const cfg = s.config;
  const mark = (a: SimAsset) => s.lastQuotes[a]?.price ?? null;
  const pos = new Map(Object.entries(s.positions) as [SimAsset, Position][]);
  const eqRial = s.acct.cash + [...pos].reduce((sum, [a, p]) => sum + (p.qty > 0 ? p.qty * (mark(a) ?? p.entryPrice) : 0), 0);
  if (!s.equity.length || s.equity[s.equity.length - 1].at !== now) pushEquity(s, now, today, eqRial);
  const traded = cfg.assets.filter((a) => isNum(s.startQuotes[a]));
  const warnings: string[] = [];
  if (s.ticks < 10) warnings.push(`فقط ${s.ticks.toLocaleString('fa-IR')} بار قیمت‌ها بررسی شد؛ نتیجه نماینده یک معامله‌گر برخط واقعی نیست.`);
  const gaps = s.events.filter((e) => e.kind === 'gap').length;
  if (gaps) warnings.push(`${gaps.toLocaleString('fa-IR')} بار فاصله بین بررسی‌ها بیش از ۴۵ دقیقه شد؛ برخی حرکت‌های قیمت پایش نشد.`);
  if (s.pending.length) warnings.push(`${s.pending.length.toLocaleString('fa-IR')} سفارش به‌علت بسته بودن بازار تا پایان اجرا نشد.`);

  const result = buildResult({
    input: { start: tehranDate(new Date(s.startedAt)), end: today, capitalToman: cfg.capitalToman, profile: cfg.profile, assets: traded, fixedIncomeYield: cfg.fixedIncomeYield },
    firstDate: tehranDate(new Date(s.startedAt)),
    lastDate: today,
    equity: s.equity,
    trades: s.trades,
    exposures: s.exposures.length ? s.exposures : [0],
    acct: s.acct,
    pos,
    priceStart: (a) => s.startQuotes[a] ?? null,
    priceEnd: (a) => mark(a),
    series: Object.fromEntries(traded.map((a) => [a, { basis: 'قیمت زنده', reconstructed: false }])),
    startUsd: s.startUsd,
    news: s.newsSeen,
    newsUse: new Map(Object.entries(s.newsUse)),
    warnings,
    paramsVersion: s.params.version,
  });
  result.analysis = analyse(result, s.newsSeen.length, 'live');
  s.result = { ...result, equity: [] }; // the session already holds the equity curve; don't store it twice
  s.status = 'finished';
  s.finishedAt = now;
  s.endReason = reason;
  s.pending = [];
  const e: LiveEvent = { at: now, kind: 'finish', text: reason === 'stopped' ? 'معامله برخط به دستور کاربر پایان یافت.' : 'مدت معامله برخط به پایان رسید.' };
  s.events.unshift(e);
  return result;
}
