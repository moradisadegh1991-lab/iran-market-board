// نوسان‌گیری کریپتو — swing trading on hourly bars.
// Deliberately different from the multi-asset backtest in simulator.ts: one coin, long-only,
// one position at a time, holding hours-to-days instead of weeks. Pure: the caller supplies bars.
//
// Honest limits, by construction:
//  • hourly closes only — no highs/lows, so an intrabar stop is detected at the close that breaches it,
//    which makes stops slightly optimistic in fast drops. Modelled by charging `slipPct` extra on stop exits.
//  • every trade pays fee+spread on both sides; an aggressive preset that trades often will be dragged by it.
//  • CoinGecko hourly history is capped (~90 days), so this measures a regime, not a long-run edge.
import { isNum } from '@/lib/num';
import { emaSeries, maxDrawdown, rsiSeries, std } from './stats';

export interface SwingBar {
  t: number; // ms
  p: number; // USD
}

export type SwingPreset = 'calm' | 'normal' | 'aggressive';

export interface SwingConfig {
  capitalToman: number;
  preset: SwingPreset;
  feePct: number; // per side, % (exchange fee + tether spread)
  usdtRial: number | null; // for toman reporting; null → report in USD only
}

export const SWING_PRESETS: Record<SwingPreset, {
  label: string;
  note: string;
  fastH: number; // fast EMA, hours
  slowH: number; // slow EMA, hours
  dipK: number; // how far below fast EMA counts as a dip, in units of hourly vol
  rsiBuy: number;
  breakoutH: number; // breakout lookback, hours
  targetK: number; // take-profit, in units of daily vol (hourly vol × √24)
  stopK: number; // stop, same units — kept below targetK so the payoff is asymmetric
  maxHoldH: number;
  cooldownH: number;
  exposure: number; // share of capital per trade
  /** How trendy the market must be to use trend rules, as a percentile of the coin's OWN recent
   *  efficiency-ratio distribution (0.6 = trendier than 60% of its recent past). A percentile is
   *  used rather than an absolute ratio because absolute ER depends heavily on bar size and the
   *  coin's noise: on hourly crypto bars even a strong trend rarely exceeds 0.２, so a fixed
   *  threshold silently disables the trend branch. */
  trendERpct: number;
  /** absolute efficiency-ratio floor; without it, a series that never trends still produces
   *  "trending" bars simply because some of its bars rank high against its own flat history */
  trendERmin: number;
  /** in chop, take profit at this multiple of daily vol — closer in, because moves revert */
  chopTargetK: number;
  /** in chop the stop must be tighter than the (already short) target, or a 50% win rate still
   *  loses money: the trade risks more than it stands to make on every entry */
  chopStopK: number;
  /** start trailing once the trade is this many daily-vol units in profit; 0 disables trailing */
  trailAfterK: number;
  /** trailing stop distance, in daily-vol units */
  trailK: number;
  /** bars the fast EMA must stay below the slow one before a trend exit fires */
  trendExitBars: number;
}> = {
  calm: {
    label: 'کم‌تحرک',
    note: 'فقط اصلاح‌های عمیق در روند صعودی؛ معاملات کم، هدف و حد ضرر دورتر',
    fastH: 36, slowH: 168, dipK: 1.6, rsiBuy: 36, breakoutH: 120, targetK: 1.8, stopK: 1.3, maxHoldH: 240, cooldownH: 24, exposure: 0.5,
    trendERpct: 0.62, trendERmin: 0.17, chopTargetK: 1.5, chopStopK: 1.3, trailAfterK: 1.4, trailK: 1.6, trendExitBars: 4,
  },
  normal: {
    label: 'متعادل',
    note: 'ترکیب خرید در اصلاح و شکست سقف کوتاه‌مدت',
    fastH: 24, slowH: 120, dipK: 1.1, rsiBuy: 42, breakoutH: 72, targetK: 1.3, stopK: 1.0, maxHoldH: 144, cooldownH: 12, exposure: 0.7,
    trendERpct: 0.58, trendERmin: 0.15, chopTargetK: 1.2, chopStopK: 1.0, trailAfterK: 1.2, trailK: 1.4, trendExitBars: 3,
  },
  aggressive: {
    label: 'پرتحرک',
    note: 'ورودهای بیشتر و اهداف نزدیک‌تر؛ کارمزد و اسپرد اثر بیشتری می‌گذارد',
    fastH: 12, slowH: 72, dipK: 0.7, rsiBuy: 48, breakoutH: 36, targetK: 0.85, stopK: 0.7, maxHoldH: 72, cooldownH: 4, exposure: 0.9,
    trendERpct: 0.54, trendERmin: 0.13, chopTargetK: 0.9, chopStopK: 0.7, trailAfterK: 0.9, trailK: 1.0, trendExitBars: 2,
  },
};

export type SwingExit = 'target' | 'trail' | 'stop' | 'trend' | 'timeout' | 'end';
export const SWING_EXIT_LABEL: Record<SwingExit, string> = {
  target: 'رسیدن به هدف سود',
  trail: 'حد ضرر متحرک (قفل سود)',
  stop: 'حد ضرر',
  trend: 'شکسته‌شدن روند',
  timeout: 'پایان مهلت نگه‌داری',
  end: 'پایان دوره شبیه‌سازی',
};

export interface SwingTrade {
  n: number;
  entryAt: number;
  exitAt: number;
  holdH: number;
  entryPrice: number; // USD
  exitPrice: number; // USD
  qty: number;
  entryReason: string;
  exit: SwingExit;
  grossPct: number; // before costs
  netPct: number; // after fees/slippage, on the money committed
  pnlToman: number;
  feeToman: number;
  equityAfter: number; // toman
  targetPrice: number;
  stopPrice: number;
}

export interface SwingMetrics {
  startEquity: number;
  finalEquity: number;
  pnlToman: number;
  returnPct: number;
  buyHoldPct: number; // same coin, bought at the start and held (USD terms, fee once each way)
  usdtPct: number | null; // simply holding tether over the window (rial-denominated benchmark)
  trades: number;
  wins: number;
  winRatePct: number | null;
  avgHoldH: number | null;
  bestPct: number | null;
  worstPct: number | null;
  stops: number;
  feesToman: number;
  maxDrawdownPct: number;
  timeInMarketPct: number;
  barsUsed: number;
  fromAt: number;
  toAt: number;
}

export interface SwingResult {
  coin: { id: string; symbol: string; name: string };
  config: SwingConfig;
  preset: (typeof SWING_PRESETS)[SwingPreset];
  metrics: SwingMetrics;
  trades: SwingTrade[];
  equity: { t: number; equity: number; price: number; inMarket: boolean }[];
  warnings: string[];
}

/** Hourly close-to-close volatility, from the last `n` bars ending at i (inclusive). */
function localVol(rets: (number | null)[], i: number, n: number): number {
  const win: number[] = [];
  for (let k = Math.max(1, i - n + 1); k <= i; k++) {
    const r = rets[k];
    if (isNum(r)) win.push(r);
  }
  const s = std(win);
  return isNum(s) && s > 0 ? s : 0.01;
}

/**
 * Kaufman efficiency ratio over the last n bars: net move ÷ total path travelled.
 * ~1 means a clean directional trend, ~0 means the price went nowhere noisily.
 * This is what tells the strategy whether trend rules or mean-reversion rules apply.
 */
/** Where `value` sits within the last `n` efficiency ratios (0..1). */
function erPercentile(hist: number[], i: number, value: number): number {
  const from = Math.max(0, i - 480);
  const slice = hist.slice(from, i);
  if (slice.length < 60) return 0.5; // not enough history to judge the regime either way
  let below = 0;
  for (const v of slice) if (v <= value) below++;
  return below / slice.length;
}

/** Median absolute hourly return over a long window — the coin's own "normal" volatility. */
function medianVol(rets: (number | null)[], i: number, n: number): number {
  const xs: number[] = [];
  for (let k = Math.max(1, i - n); k <= i; k++) {
    const r = rets[k];
    if (isNum(r)) xs.push(Math.abs(r!));
  }
  if (xs.length < 30) return 0;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] * 1.2533; // scale median |r| to an approximate sd
}

function efficiencyRatio(prices: number[], i: number, n: number): number {
  const from = Math.max(0, i - n);
  if (i - from < 4) return 0;
  const net = Math.abs(prices[i] - prices[from]);
  let path = 0;
  for (let k = from + 1; k <= i; k++) path += Math.abs(prices[k] - prices[k - 1]);
  return path > 0 ? net / path : 0;
}

function fa(n: number, digits = 1): string {
  return n.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Runs the swing strategy over `bars` (ascending, hourly).
 * Long-only, at most one open position, no leverage, no shorting.
 */
export function runSwing(bars: SwingBar[], coin: { id: string; symbol: string; name: string }, config: SwingConfig): SwingResult {
  const P = SWING_PRESETS[config.preset];
  const warnings: string[] = [];
  const clean = bars.filter((b) => isNum(b.p) && b.p > 0 && isNum(b.t)).sort((a, b) => a.t - b.t);
  if (clean.length < P.slowH + 24) {
    throw new Error(`داده ساعتی کافی نیست: ${clean.length.toLocaleString('fa-IR')} کندل دریافت شد، برای این تنظیم دست‌کم ${(P.slowH + 24).toLocaleString('fa-IR')} کندل لازم است.`);
  }

  const prices = clean.map((b) => b.p);
  const fast = emaSeries(prices, P.fastH);
  const slow = emaSeries(prices, P.slowH);
  const rsi = rsiSeries(prices, 14);
  const rets: (number | null)[] = prices.map((p, i) => (i === 0 ? null : Math.log(p / prices[i - 1])));
  const erHist = prices.map((_, i) => efficiencyRatio(prices, i, 96));

  const fee = config.feePct / 100;
  const slipPct = 0.0015; // extra cost charged on stop exits (see header note)

  let cash = config.capitalToman;
  let qty = 0; // coin units
  let entryPrice = 0;
  let entryAt = 0;
  let entryIdx = -1;
  let entryReason = '';
  let target = 0;
  let stop = 0;
  let committed = 0; // toman taken out of cash for the open trade
  let netIn = 0; // committed minus the entry fee — this is what actually tracks the price
  let cooldownUntil = 0;
  let barsInMarket = 0;
  let entrySpan = 0; // daily-vol unit at entry, reused for the trailing distance
  let trailArmed = false;
  let belowTrend = 0; // consecutive bars with fast EMA under slow EMA
  let entryChop = false; // regime at the time this position was opened
  let strongTrend = false;

  const trades: SwingTrade[] = [];
  const equity: SwingResult['equity'] = [];
  const usdToToman = (usd: number) => (isNum(config.usdtRial) ? (usd * config.usdtRial) / 10 : usd);
  const start = Math.max(P.slowH, 24);

  /**
   * `why` decides the fill price, not just the label:
   *  - a take-profit is a limit order, so it fills at the target;
   *  - a stop fills at the stop level plus slippage.
   * Filling both at the bar CLOSE (as this used to) charged the whole hourly candle to the
   * trade: stops realised ~−4% against a −1σ stop, so losers were bigger than winners even
   * though the stop sat closer than the target. Hourly closes say nothing about the path
   * within the bar, so the trigger level is the better estimate.
   */
  const close = (i: number, why: SwingExit) => {
    const bar = prices[i];
    const px =
      why === 'target' && Number.isFinite(target) ? target : // limit order fills at the target
      why === 'stop' || why === 'trail' ? stop :             // stop order fills at the stop (slipPct is charged separately)
      bar;                                                    // trend / timeout / end exit at market
    const gross = px / entryPrice - 1;
    const extra = why === 'stop' ? slipPct : 0;
    const grossOut = netIn * (1 + gross); // value of the position before the exit fee
    const proceeds = grossOut * (1 - fee - extra);
    const feeToman = committed * fee + grossOut * (fee + extra);
    cash += proceeds;
    const pnl = proceeds - committed;
    trades.push({
      n: trades.length + 1,
      entryAt, exitAt: clean[i].t, holdH: i - entryIdx,
      entryPrice, exitPrice: px, qty,
      entryReason, exit: why,
      grossPct: gross * 100,
      netPct: (proceeds / committed - 1) * 100,
      pnlToman: pnl, feeToman,
      equityAfter: cash,
      targetPrice: target, stopPrice: stop,
    });
    qty = 0; committed = 0; netIn = 0; entryIdx = -1;
    cooldownUntil = i + P.cooldownH;
  };

  for (let i = start; i < clean.length; i++) {
    const px = prices[i];
    const inPos = qty > 0;

    if (inPos) {
      barsInMarket++;
      const under = isNum(fast[i]) && isNum(slow[i]) && fast[i]! < slow[i]!;
      belowTrend = under ? belowTrend + 1 : 0;

      // Ratchet the stop up once the trade is far enough in profit. Without this, winners
      // ran back to the entry stop and exited on trend-break, giving back the whole move.
      if (P.trailAfterK > 0 && !entryChop) {
        const span = entrySpan;
        if (!trailArmed && px >= entryPrice * (1 + P.trailAfterK * span)) trailArmed = true;
        if (trailArmed) stop = Math.max(stop, px * (1 - P.trailK * span));
      }

      // A single bar of fast<slow is noise in a choppy market — that one-bar exit was
      // closing dip buys at a loss moments after entry. Require confirmation, and in
      // chop don't use the trend exit at all (mean reversion is the thesis there).
      const trendBroken = !entryChop && belowTrend >= P.trendExitBars;

      if (px <= stop) close(i, trailArmed ? 'trail' : 'stop');
      else if (px >= target) close(i, 'target');
      else if (trendBroken) close(i, 'trend');
      else if (i - entryIdx >= (entryChop ? Math.round(P.maxHoldH * 0.6) : P.maxHoldH)) close(i, 'timeout');
    } else if (i >= cooldownUntil && i < clean.length - 1) {
      const f = fast[i];
      const s = slow[i];
      const r = rsi[i];
      const up = isNum(f) && isNum(s) && f! > s!;
      const vol = localVol(rets, i, 72);
      let reason: string | null = null;

      const er = efficiencyRatio(prices, i, 96);
      const erRank = erPercentile(erHist, i, er);
      const trending = erRank >= P.trendERpct && er >= P.trendERmin;

      if (trending && up) {
        // Directional market: dips, oversold bounces and genuine breakouts all qualify.
        // Tested the looser alternative of allowing dip/oversold entries in ANY uptrend:
        // it earned +6pp in a sustained trend but cost ~9pp in a range and ~16pp in a random
        // walk, because those entries then fire constantly in chop. Kept the stricter gate.
        const dipLine = f! * (1 - P.dipK * vol);
        const recentHigh = Math.max(...prices.slice(Math.max(0, i - P.breakoutH), i));
        if (px <= dipLine) reason = `اصلاح در روند صعودی: قیمت ${fa((1 - px / f!) * 100)}٪ زیر میانگین ${P.fastH.toLocaleString('fa-IR')} ساعته`;
        else if (isNum(r) && r! <= P.rsiBuy) reason = `اشباع فروش کوتاه‌مدت در روند صعودی (RSI ${fa(r!, 0)})`;
        else if (px > recentHigh) reason = `شکست سقف ${P.breakoutH.toLocaleString('fa-IR')} ساعته در بازار روندی`;
      } else if (!trending) {
        // range-bound market: only buy genuine stretch below the mean, and never buy a
        // breakout — in chop the "breakout" is usually the top of the range.
        const stretch = f! > 0 ? (f! - px) / (f! * Math.max(vol, 1e-6)) : 0;
        const oversold = isNum(r) && r! <= P.rsiBuy - 4;
        if (stretch >= P.dipK * 1.15 && oversold) {
          reason = `بازار بی‌روند (صدک روند ${fa(erRank * 100, 0)}): خرید در کف دامنه، ${fa((1 - px / f!) * 100)}٪ زیر میانگین`;
        }
      }
      // blow-off guard: don't buy a vertical candle
      const last6 = i >= 6 ? px / prices[i - 6] - 1 : 0;
      if (reason && last6 > 6 * vol) {
        reason = null;
      }

      if (reason) {
        // daily vol: the natural scale for a trade meant to last hours-to-days.
        // Scaling by √maxHoldH instead put take-profit near +18%, which no swing trade reaches,
        // so every position used to exit on trend-break or stop.
        const span = vol * Math.sqrt(24);
        // Risk-parity sizing: when the coin is unusually volatile for itself, commit less.
        // A flat share of capital made the worst drawdowns land exactly in the wildest stretches.
        const medVol = medianVol(rets, i, 480);
        const volAdj = medVol > 0 ? Math.max(0.45, Math.min(1, medVol / Math.max(vol, 1e-9))) : 1;
        entrySpan = span;
        entryChop = !trending;
        trailArmed = false;
        belowTrend = 0;
        committed = cash * P.exposure * volAdj;
        if (committed > 0) {
          netIn = committed * (1 - fee);
          const usdIn = isNum(config.usdtRial) ? (netIn * 10) / config.usdtRial : netIn;
          qty = usdIn / px;
          entryPrice = px;
          entryAt = clean[i].t;
          entryIdx = i;
          entryReason = reason;
          // In a decisively trending market a fixed take-profit caps exactly the moves
          // worth holding, so there the trailing stop alone closes the trade.
          strongTrend = trending && erRank >= Math.min(0.95, P.trendERpct + 0.2);
          target = strongTrend ? Infinity : px * (1 + (trending ? P.targetK : P.chopTargetK) * span);
          stop = px * (1 - (trending ? P.stopK : P.chopStopK) * span);
          cash -= committed;
        }
      }
    }

    const mark = qty > 0 ? netIn * (px / entryPrice) : 0;
    equity.push({ t: clean[i].t, equity: cash + mark, price: px, inMarket: qty > 0 });
  }

  if (qty > 0) close(clean.length - 1, 'end');

  const finalEquity = cash;
  const firstPx = prices[start];
  const lastPx = prices[prices.length - 1];
  const bhPct = ((lastPx / firstPx) * (1 - fee) * (1 - fee) - 1) * 100;
  const eqSeries = equity.map((e) => e.equity);
  const netPcts = trades.map((t) => t.netPct);
  const wins = trades.filter((t) => t.pnlToman > 0).length;

  if (trades.length === 0) warnings.push('در این بازه هیچ سیگنال ورودی صادر نشد؛ عدد بازده صفر یعنی سرمایه تمام مدت نقد مانده، نه اینکه استراتژی ضرر نکرده باشد.');
  if (trades.length >= 25) warnings.push('تعداد معاملات زیاد است؛ بخش بزرگی از بازده ناخالص صرف کارمزد و اسپرد می‌شود.');
  if (clean.length < 24 * 25) warnings.push('بازه داده کوتاه است؛ نتیجه بیشتر بازتاب یک وضعیت خاص بازار است تا کیفیت استراتژی.');

  return {
    coin,
    config,
    preset: P,
    metrics: {
      startEquity: config.capitalToman,
      finalEquity,
      pnlToman: finalEquity - config.capitalToman,
      returnPct: (finalEquity / config.capitalToman - 1) * 100,
      buyHoldPct: bhPct,
      usdtPct: null,
      trades: trades.length,
      wins,
      winRatePct: trades.length ? (wins / trades.length) * 100 : null,
      avgHoldH: trades.length ? trades.reduce((a, t) => a + t.holdH, 0) / trades.length : null,
      bestPct: netPcts.length ? Math.max(...netPcts) : null,
      worstPct: netPcts.length ? Math.min(...netPcts) : null,
      stops: trades.filter((t) => t.exit === 'stop').length,
      feesToman: trades.reduce((a, t) => a + t.feeToman, 0),
      maxDrawdownPct: maxDrawdown(eqSeries) * 100,
      timeInMarketPct: (barsInMarket / (clean.length - start)) * 100,
      barsUsed: clean.length,
      fromAt: clean[start].t,
      toAt: clean[clean.length - 1].t,
    },
    trades,
    equity,
    warnings,
  };
}
