// نوسان‌گیری نسخه ۲ — the swing engine rebuilt on what the real-data evaluation showed.
//
// scripts/eval/swing-eval.ts ran v1 over a real year of hourly candles for 14 coins. On the design
// half it lost money in 99% of 90-day windows, and it still lost with zero fees: stops fired twice
// as often as targets because it bought dips inside higher-timeframe downtrends, and it traded so
// often that a 0.8% round trip ate whatever was left. v2 changes the thesis, not the knobs:
//
//  1. Trade only WITH the higher timeframe. Long-only means the best thing to do in a falling
//     market is nothing; a 20-day trend gate (and, for altcoins, a BTC regime gate — alts follow
//     BTC down) keeps the engine in cash there.
//  2. Fewer, better entries. Every candidate is scored 0–100 on independent pieces of evidence
//     (trend, market regime, momentum and relative strength, the setup itself, volume) and only
//     high-confluence ones trade. Position size grows with the score.
//  3. Real execution. With exchange OHLC a stop fires when the LOW touches it (at the open if the
//     bar gaps through), a target when the HIGH reaches it, and a bar that touches both is
//     scored as a loss. v1 only saw closes, which flattered every stop.
//  4. Stops sit under market structure (the recent swing low), sized in volatility units, and the
//     target is a multiple of that risk; past +1R the stop moves to break-even and then trails.
//
// Everything at bar i is computed from bars ≤ i, so live replay (swing-live.ts) stays append-only.
import { clamp, isNum } from '@/lib/num';
import { emaSeries, rsiSeries } from './stats';
import { barRates, finalizeSwing, SWING_PRESETS, type SwingBar, type SwingConfig, type SwingExit, type SwingPreset, type SwingResult, type SwingTrade } from './swing';

const DAY_H = 24;
/** indicator warm-up: the slow EMA spans 20 days and its slope is read over another 3 */
export const V2_WARMUP_H = 480 + 72;

export const SWING_V2: Record<SwingPreset, {
  /** minimum confluence score (0–100) to enter */
  minScore: number;
  /** initial stop distance clipped to [minStopU, maxStopU] volatility units */
  minStopU: number;
  maxStopU: number;
  /** take-profit as a multiple of the initial risk R */
  targetR: number;
  /** trailing distance in volatility units, armed once the trade is +1.5R */
  trailU: number;
  exposure: number;
  maxHoldH: number;
  /** exit a trade that has not made +0.5R after this many hours — the setup failed */
  staleH: number;
  cooldownH: number;
  cooldownAfterStopH: number;
}> = {
  // trend: only `exposure` is used — see runTrendRide
  trend: { minScore: 0, minStopU: 0, maxStopU: 0, targetR: Infinity, trailU: 0, exposure: 0.9, maxHoldH: Infinity, staleH: Infinity, cooldownH: 0, cooldownAfterStopH: 0 },
  calm: { minScore: 72, minStopU: 0.9, maxStopU: 1.8, targetR: 2.6, trailU: 1.6, exposure: 0.6, maxHoldH: 336, staleH: 96, cooldownH: 24, cooldownAfterStopH: 72 },
  normal: { minScore: 64, minStopU: 0.8, maxStopU: 1.6, targetR: 2.2, trailU: 1.4, exposure: 0.75, maxHoldH: 240, staleH: 72, cooldownH: 12, cooldownAfterStopH: 48 },
  aggressive: { minScore: 56, minStopU: 0.7, maxStopU: 1.4, targetR: 1.8, trailU: 1.2, exposure: 0.9, maxHoldH: 168, staleH: 48, cooldownH: 6, cooldownAfterStopH: 24 },
};

export interface V2Evidence {
  trend: number; // 0–30
  market: number; // 0–20
  momentum: number; // 0–20
  setup: number; // 0–20
  volume: number; // 0–10
  penalty: number; // ≤ 0
}

const fa = (n: number, d = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: d, minimumFractionDigits: d });

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** BTC closes aligned to this coin's bars (last known value carried forward; null before it starts). */
function alignMarket(clean: SwingBar[], market: SwingBar[] | null | undefined): (number | null)[] | null {
  if (!market || market.length < 50) return null;
  const m = market.filter((b) => isNum(b.p) && b.p > 0).sort((a, b) => a.t - b.t);
  const out: (number | null)[] = [];
  let k = 0;
  let last: number | null = null;
  for (const b of clean) {
    while (k < m.length && m[k].t <= b.t) last = m[k++].p;
    out.push(last);
  }
  return out;
}

/** EMA over a series that may start with nulls (the market series before its first bar). */
function emaNullable(xs: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let e: number | null = null;
  let seen = 0;
  for (const x of xs) {
    if (!isNum(x)) {
      out.push(null);
      continue;
    }
    e = e === null ? x : x * k + e * (1 - k);
    seen++;
    out.push(seen >= n ? e : null);
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * For each hourly bar: is the latest CLOSED day above its 50-day simple average? null when there
 * is not enough daily history. A day counts only once it has closed by the end of the bar, so the
 * filter never sees the day it is trading in.
 */
export function dailyRegime(clean: SwingBar[], daily: SwingBar[] | null | undefined, n = 50): (boolean | null)[] | null {
  const r = dailyRegimeSma(clean, daily, n);
  return r ? r.map((x) => (x ? x.up : null)) : null;
}

/** Same, with the 50-day average itself (the level whose daily close below ends a trend ride). */
export function dailyRegimeSma(clean: SwingBar[], daily: SwingBar[] | null | undefined, n = 50): ({ up: boolean; sma: number } | null)[] | null {
  if (!daily || daily.length < n + 1) return null;
  const d = daily.filter((b) => isNum(b.p) && b.p > 0).sort((a, b) => a.t - b.t);
  const per: ({ up: boolean; sma: number } | null)[] = d.map((_, k) => {
    if (k + 1 < n) return null;
    let sum = 0;
    for (let j = k - n + 1; j <= k; j++) sum += d[j].p;
    return { up: d[k].p > sum / n, sma: sum / n };
  });
  const out: ({ up: boolean; sma: number } | null)[] = [];
  let k = -1;
  for (const b of clean) {
    while (k + 1 < d.length && d[k + 1].t + DAY_MS <= b.t + 3_600_000) k++;
    out.push(k >= 0 ? per[k] : null);
  }
  return out;
}

/** UTC daily closes built from hourly bars — only for days fully covered and already closed. */
export function dailyFromHourly(bars: SwingBar[] | null | undefined): SwingBar[] | null {
  if (!bars || bars.length < 24 * 52) return null;
  const m = new Map<number, { p: number; n: number }>();
  for (const b of bars) {
    const day = Math.floor(b.t / DAY_MS) * DAY_MS;
    const e = m.get(day);
    m.set(day, { p: b.p, n: (e?.n ?? 0) + 1 });
  }
  const lastT = bars[bars.length - 1].t;
  return [...m.entries()]
    .filter(([day, e]) => e.n >= 20 && day + DAY_MS <= lastT + 3_600_000)
    .sort((a, b) => a[0] - b[0])
    .map(([t, e]) => ({ t, p: e.p }));
}

/**
 * «روندسوار» — hold while the coin's last closed day is above its 50-day average (and BTC's is
 * too, for an altcoin); cash otherwise. The decision only changes when a day closes, so it trades
 * a few times a month at most and pays the fee rarely.
 *
 * Why this exists: on three years of real hourly data (scripts/eval), every hourly swing variant
 * lost money after the 0.8% round-trip cost — in the bear year AND in the 2024 bull market. This
 * textbook rule, untuned, cut the bear-year loss from −24% to −1% (13 of 14 coins beat holding)
 * and kept roughly half of the bull-market gain. It is a trend filter, not a forecast: it gives
 * back part of every move before it exits, and in a sideways market it whipsaws.
 */
function runTrendRide(clean: SwingBar[], coin: SwingResult['coin'], config: SwingConfig, warnings: string[]): SwingResult {
  const P = SWING_PRESETS.trend;
  const Q = { ...SWING_V2.trend, ...(config.v2Overrides ?? {}) };
  const daily = config.daily && config.daily.length > 51 ? config.daily : dailyFromHourly(clean);
  const regime = dailyRegimeSma(clean, daily);
  if (!regime || !regime.some(Boolean)) {
    throw new Error('برای سبک روندسوار دست‌کم ۵۱ روز تاریخچه روزانه لازم است (میانگین ۵۰ روزه).');
  }
  const mktDaily = config.marketDaily && config.marketDaily.length > 51 ? config.marketDaily : dailyFromHourly(config.market ?? null);
  const mkt = mktDaily ? dailyRegimeSma(clean, mktDaily) : null;
  const C = clean.map((b) => b.p);
  const tradeFromIdx = isNum(config.tradeFrom) ? Math.max(0, clean.findIndex((b) => b.t >= config.tradeFrom!)) : 0;
  const start = Math.max(1, tradeFromIdx, regime.findIndex(Boolean));
  const { rates, fixedFx } = barRates(clean, config);
  const toToman = (usd: number, i: number) => (isNum(rates[i]) ? (usd * rates[i]!) / 10 : usd);
  const toUsd = (toman: number, i: number) => (isNum(rates[i]) ? (toman * 10) / rates[i]! : toman);
  const fee = config.feePct / 100;

  let cash = config.capitalToman;
  let qty = 0, committed = 0, entryPrice = 0, entryAt = 0, entryIdx = -1, entrySma = 0, barsInMarket = 0;
  let entryReason = '';
  const trades: SwingTrade[] = [];
  const equity: SwingResult['equity'] = [];
  const exit = (i: number, why: SwingExit) => {
    const grossOut = toToman(qty * C[i], i);
    const proceeds = grossOut * (1 - fee);
    cash += proceeds;
    trades.push({
      n: trades.length + 1, entryAt, exitAt: clean[i].t, holdH: i - entryIdx, entryPrice, exitPrice: C[i], qty, entryReason, exit: why,
      grossPct: (C[i] / entryPrice - 1) * 100, netPct: (proceeds / committed - 1) * 100, pnlToman: proceeds - committed,
      feeToman: committed * fee + grossOut * fee, equityAfter: cash, targetPrice: Infinity, stopPrice: entrySma,
    });
    qty = 0;
    committed = 0;
  };
  for (let i = start; i < clean.length; i++) {
    const g = regime[i];
    const m = mkt ? mkt[i] : null;
    const want = !!g && g.up && (!m || m.up);
    if (qty > 0) {
      barsInMarket++;
      if (!want) exit(i, 'trend');
    } else if (want && i < clean.length - 1) {
      committed = cash * Q.exposure;
      qty = toUsd(committed * (1 - fee), i) / C[i];
      entryPrice = C[i];
      entryAt = clean[i].t;
      entryIdx = i;
      entrySma = g!.sma;
      const pct = (C[i] / g!.sma - 1) * 100;
      entryReason = `روز بسته‌شده بالای میانگین ۵۰ روزه (${fa(pct, 1)}٪ بالاتر)${m ? ' · بیت‌کوین هم بالای میانگین ۵۰ روزه' : ''} — نگه‌داری تا بسته‌شدن روزانه زیر میانگین`;
      cash -= committed;
    }
    equity.push({ t: clean[i].t, equity: cash + (qty > 0 ? toToman(qty * C[i], i) : 0), price: C[i], inMarket: qty > 0 });
  }
  if (qty > 0) exit(clean.length - 1, 'end');
  if (trades.length === 0) warnings.push('در این بازه روند روزانه صعودی نشد؛ سرمایه نقد ماند.');
  return finalizeSwing({ coin, config, preset: P, clean, prices: C, rates, fixedFx, start, fee, cash, barsInMarket, trades, equity, warnings });
}

export function runSwingV2(bars: SwingBar[], coin: SwingResult['coin'], config: SwingConfig): SwingResult {
  const P = SWING_PRESETS[config.preset];
  const Q = { ...SWING_V2[config.preset], ...(config.v2Overrides ?? {}) } as (typeof SWING_V2)[SwingPreset];
  const warnings: string[] = [];
  const clean = bars.filter((b) => isNum(b.p) && b.p > 0 && isNum(b.t)).sort((a, b) => a.t - b.t);
  if (config.preset === 'trend') return runTrendRide(clean, coin, config, warnings);
  const tradeFromIdx = isNum(config.tradeFrom) ? Math.max(0, clean.findIndex((b) => b.t >= config.tradeFrom!)) : 0;
  const start = Math.max(V2_WARMUP_H, tradeFromIdx);
  if (clean.length < start + 48) {
    throw new Error(
      `داده ساعتی کافی نیست: ${clean.length.toLocaleString('fa-IR')} کندل دریافت شد؛ موتور نسخه ۲ برای گرم شدن شاخص‌ها ${V2_WARMUP_H.toLocaleString('fa-IR')} کندل (۲۳ روز) پیش از بازه معامله لازم دارد.`,
    );
  }

  const C = clean.map((b) => b.p);
  const hasOhlc = clean.every((b) => isNum(b.h) && isNum(b.l));
  const O = clean.map((b) => (isNum(b.o) ? b.o! : b.p));
  const Hh = clean.map((b) => (hasOhlc ? Math.max(b.h!, b.p) : b.p));
  const Ll = clean.map((b) => (hasOhlc ? Math.min(b.l!, b.p) : b.p));
  const V = clean.map((b) => (isNum(b.v) ? b.v! : null));
  const hasVol = V.filter(isNum).length > clean.length * 0.9;
  if (!hasOhlc) warnings.push('کندل کامل (سقف/کف/حجم) در دسترس نبود؛ حد ضرر و هدف با قیمت پایانی هر ساعت سنجیده شد که خوش‌بینانه‌تر است.');

  const emaF = emaSeries(C, 48);
  const emaM = emaSeries(C, 168);
  const emaS = emaSeries(C, 480);
  const rsi = rsiSeries(C, 14);
  // true range → average over 48 bars; U is roughly one day's typical range
  const tr = C.map((c, i) => (i === 0 ? Hh[0] - Ll[0] : Math.max(Hh[i] - Ll[i], Math.abs(Hh[i] - C[i - 1]), Math.abs(Ll[i] - C[i - 1]))));
  const atr: number[] = [];
  let acc = 0;
  for (let i = 0; i < tr.length; i++) {
    acc += tr[i];
    if (i >= 48) acc -= tr[i - 48];
    atr.push(acc / Math.min(i + 1, 48));
  }
  const unit = (i: number) => Math.max((atr[i] / C[i]) * Math.sqrt(DAY_H), 0.004); // fraction of price

  const M = alignMarket(clean, config.market);
  const mEmaM = M ? emaNullable(M, 168) : null;
  const mEmaS = M ? emaNullable(M, 480) : null;

  // Long-term regime (daily closes vs their 50-day average). In the real-data evaluation the dev
  // half was a 45% crypto bear market; this is the filter that keeps a long-only engine out of it.
  const longUp = dailyRegime(clean, config.daily);
  const mktLongUp = dailyRegime(clean, config.marketDaily);
  if (!longUp) warnings.push('تاریخچه روزانه برای فیلتر روند بلندمدت (میانگین ۵۰ روزه) در دسترس نبود؛ ورودها فقط با روند ساعتی فیلتر شدند.');

  const { rates, fixedFx } = barRates(clean, config);
  const toToman = (usd: number, i: number) => (isNum(rates[i]) ? (usd * rates[i]!) / 10 : usd);
  const toUsd = (toman: number, i: number) => (isNum(rates[i]) ? (toman * 10) / rates[i]! : toman);

  const fee = config.feePct / 100;
  const slipPct = 0.0015; // charged on stop exits, on top of the fee

  let cash = config.capitalToman;
  let qty = 0;
  let committed = 0;
  let entryPrice = 0;
  let entryAt = 0;
  let entryIdx = -1;
  let entryReason = '';
  let entryScore = 0;
  let stop = 0;
  let target = Infinity;
  let risk = 0; // R, price units
  let peak = 0; // highest high since entry
  let trailing = false;
  let cooldownUntil = 0;
  let barsInMarket = 0;
  const trades: SwingTrade[] = [];
  const equity: SwingResult['equity'] = [];
  const initialStop = { v: 0 };

  const exit = (i: number, px: number, why: SwingExit) => {
    const extra = why === 'stop' || why === 'trail' ? slipPct : 0;
    const grossOut = toToman(qty * px, i);
    const proceeds = grossOut * (1 - fee - extra);
    cash += proceeds;
    trades.push({
      n: trades.length + 1,
      entryAt,
      exitAt: clean[i].t,
      holdH: i - entryIdx,
      entryPrice,
      exitPrice: px,
      qty,
      entryReason,
      exit: why,
      grossPct: (px / entryPrice - 1) * 100,
      netPct: (proceeds / committed - 1) * 100,
      pnlToman: proceeds - committed,
      feeToman: committed * fee + grossOut * (fee + extra),
      equityAfter: cash,
      targetPrice: target,
      stopPrice: why === 'stop' ? initialStop.v : stop,
      score: entryScore,
    });
    qty = 0;
    committed = 0;
    entryIdx = -1;
    cooldownUntil = i + (why === 'stop' ? Q.cooldownAfterStopH : Q.cooldownH);
  };

  for (let i = start; i < clean.length; i++) {
    if (qty > 0) {
      barsInMarket++;
      // ── exits on THIS bar, against levels fixed at the end of the previous bar ──
      const stopKind: SwingExit = trailing ? 'trail' : 'stop';
      const hitStop = Ll[i] <= stop;
      const hitTarget = Hh[i] >= target;
      if (O[i] <= stop) exit(i, O[i], stopKind); // gapped through the stop
      else if (hitStop) exit(i, stop, stopKind); // a bar that touched both is booked as the loss
      else if (O[i] >= target) exit(i, O[i], 'target');
      else if (hitTarget) exit(i, target, 'target');
      else if (isNum(emaS[i]) && C[i] < emaS[i]! * (1 - 0.3 * unit(i))) exit(i, C[i], 'trend'); // the higher-timeframe thesis is gone
      else if (i - entryIdx >= Q.staleH && peak < entryPrice + 0.5 * risk) exit(i, C[i], 'timeout'); // never got going
      else if (i - entryIdx >= Q.maxHoldH) exit(i, C[i], 'timeout');
      else {
        // ── manage the stop for the NEXT bar (only information up to bar i) ──
        peak = Math.max(peak, Hh[i]);
        // break-even at +1R was measured to turn would-be winners into scratch trades; wait for 1.5R
        if (peak >= entryPrice + 1.5 * risk) {
          stop = Math.max(stop, entryPrice * (1 + 2 * fee + slipPct)); // can no longer turn into a loss
          trailing = true;
          stop = Math.max(stop, peak - Q.trailU * unit(i) * C[i]);
        }
      }
    } else if (i >= cooldownUntil && i < clean.length - 1) {
      const u = unit(i);
      const c = C[i];
      const f = emaF[i], m = emaM[i], s = emaS[i], sPrev = emaS[i - 72];
      if (!isNum(f) || !isNum(m) || !isNum(s) || !isNum(sPrev)) {
        equity.push({ t: clean[i].t, equity: cash, price: c, inMarket: false });
        continue;
      }
      const ev: V2Evidence = { trend: 0, market: 0, momentum: 0, setup: 0, volume: 0, penalty: 0 };
      const why: string[] = [];

      // 1) higher-timeframe trend (gate + score)
      // A bear-market rally pokes just above the 20-day mean and dies there, so "above" has to mean
      // clearly above, with the 7-day mean stacked over it and the 20-day mean visibly rising.
      const slopeUp = (s! - sPrev!) / sPrev! > 0.25 * u;
      const above = c > s! * (1 + 0.3 * u);
      const stacked = m! > s!;
      const htfUp = above && stacked && slopeUp;
      if (above) ev.trend += 10;
      if (stacked) ev.trend += 10;
      if (slopeUp) ev.trend += 10;

      // 2) market regime: BTC for altcoins, the coin's own medium trend for BTC itself
      let marketUp = true;
      if (M && isNum(M[i]) && isNum(mEmaS?.[i]) && isNum(mEmaM?.[i])) {
        const btcAbove = M[i]! > mEmaS![i]!;
        const btcStack = mEmaM![i]! > mEmaS![i]!;
        marketUp = btcAbove && btcStack; // alts fall harder than BTC; both conditions, not either
        ev.market = (btcAbove ? 10 : 0) + (btcStack ? 10 : 0);
      } else {
        ev.market = (c > m! ? 10 : 0) + (m! > s! ? 10 : 0);
      }

      // 3) momentum and relative strength (7 days)
      const mom7 = i >= 168 ? c / C[i - 168] - 1 : 0;
      const z = mom7 / (u * Math.sqrt(7));
      ev.momentum += 10 * clamp(z, 0, 1);
      if (M && isNum(M[i]) && isNum(M[i - 168])) {
        const rel = mom7 - (M[i]! / M[i - 168]! - 1);
        if (rel > 0) ev.momentum += 10 * clamp(rel / (u * 2), 0, 1);
      } else if (i >= 72 && c > C[i - 72]) ev.momentum += 10 * clamp((c / C[i - 72] - 1) / (u * 1.5), 0, 1);

      // 4) the setup itself — a candidate needs one of the two
      const hh72 = Math.max(...Hh.slice(i - 72, i));
      const volRatio = hasVol && isNum(V[i]) ? V[i]! / Math.max(median(V.slice(i - 72, i).filter(isNum) as number[]), 1e-9) : null;
      const breakout = c > hh72;
      const low24 = Math.min(...Ll.slice(i - 24, i + 1));
      const rsiMin24 = Math.min(...(rsi.slice(i - 24, i + 1).filter(isNum) as number[]));
      const pullback = !breakout && low24 <= m! * (1 + 0.25 * u) && rsiMin24 < 45 && c > Hh[i - 1] && c > f!;
      let setupLabel = '';
      if (breakout) {
        ev.setup = 12;
        setupLabel = `شکست سقف ۷۲ ساعته`;
      } else if (pullback) {
        ev.setup = 12 + (rsiMin24 < 38 ? 8 : 4);
        setupLabel = `برگشت از اصلاح تا میانگین ۷ روزه (کف RSI ${fa(rsiMin24)})`;
      }
      if (isNum(volRatio)) {
        ev.volume = 10 * clamp((volRatio - 1) / 1.5, 0, 1);
        if (breakout && volRatio < 1.2) ev.penalty -= 10; // a breakout nobody traded is usually a trap
      } else {
        ev.volume = 5; // unknown — neither reward nor punish
      }

      // 5) don't chase: far above the 7-day mean, or deeply overbought
      const ext = (c - m!) / (u * c);
      if (ext > 2.5) ev.penalty -= 15;
      const r = rsi[i];
      if (isNum(r) && r! > 76) ev.penalty -= 10;

      const score = clamp(ev.trend + ev.market + ev.momentum + ev.setup + ev.volume + ev.penalty, 0, 100);
      const longOk = (!longUp || longUp[i] !== false) && (!mktLongUp || mktLongUp[i] !== false);
      const candidate = (breakout || pullback) && htfUp && longOk && (marketUp || score >= Q.minScore + 12);

      if (candidate && score >= Q.minScore) {
        // structure stop under the recent swing low, clipped into a sane volatility band
        const swingLow = Math.min(...Ll.slice(i - 12, i + 1));
        const dist = clamp(c - swingLow + 0.1 * u * c, Q.minStopU * u * c, Q.maxStopU * u * c);
        // a trade whose whole risk is a couple of round trips is not worth taking
        if (dist / c > 4 * fee) {
          const conviction = 0.6 + 0.4 * clamp((score - Q.minScore) / Math.max(1, 100 - Q.minScore), 0, 1);
          const medU = median(Array.from({ length: 20 }, (_, k) => (i - k * 24 >= 48 ? unit(i - k * 24) : u)));
          const volAdj = clamp(medU / u, 0.45, 1);
          committed = cash * Q.exposure * conviction * volAdj;
          if (committed > 0) {
            qty = toUsd(committed * (1 - fee), i) / c;
            entryPrice = c;
            entryAt = clean[i].t;
            entryIdx = i;
            entryScore = Math.round(score);
            risk = dist;
            stop = c - dist;
            initialStop.v = stop;
            target = c + Q.targetR * dist;
            peak = c;
            trailing = false;
            why.push(setupLabel);
            why.push(longUp ? 'بالای میانگین ۵۰ روزه و روند ۲۰ روزه صعودی' : 'روند ۲۰ روزه صعودی');
            if (M) why.push(marketUp ? 'بیت‌کوین در روند صعودی' : 'بیت‌کوین ضعیف ولی شواهد دیگر قوی');
            if (isNum(volRatio)) why.push(`حجم ${fa(volRatio, 1)} برابر میانه ۳ روز`);
            if (mom7 > 0) why.push(`بازده ۷ روزه ${fa(mom7 * 100, 1)}٪`);
            entryReason = `${why.join(' · ')} — امتیاز ${fa(entryScore)} از ۱۰۰`;
            cash -= committed;
          }
        }
      }
    }
    const mark = qty > 0 ? toToman(qty * C[i], i) : 0;
    equity.push({ t: clean[i].t, equity: cash + mark, price: C[i], inMarket: qty > 0 });
  }
  if (qty > 0) exit(clean.length - 1, C[clean.length - 1], 'end');

  return finalizeSwing({ coin, config, preset: P, clean, prices: C, rates, fixedFx, start, fee, cash, barsInMarket, trades, equity, warnings });
}

/**
 * What each style actually did on REAL data (scripts/eval, measured 2026-10-01): average return per
 * 90-day window in USD terms after a 0.4% fee each way, 14 coins tradable in Iran. `bear` = Oct 2025
 * → Sep 2026 (buy & hold averaged −15%), `bull` = Oct 2023 → Sep 2025 (buy & hold +21%), the latter
 * never used while designing v2. Shown in the UI so a style is chosen on evidence, not on its name.
 */
export const SWING_EVIDENCE: { key: SwingPreset | 'v1'; label: string; bear: number; bull: number; dd: number; tradesPer90d: number }[] = [
  { key: 'trend', label: 'روندسوار', bear: -2.4, bull: 11.1, dd: -22.1, tradesPer90d: 3.6 },
  { key: 'calm', label: 'کم‌تحرک (نسخه ۲)', bear: -1.5, bull: -0.7, dd: -6.6, tradesPer90d: 4.4 },
  { key: 'normal', label: 'متعادل (نسخه ۲)', bear: -2.1, bull: -1.3, dd: -8.6, tradesPer90d: 5.6 },
  { key: 'aggressive', label: 'پرتحرک (نسخه ۲)', bear: -3.4, bull: -2.6, dd: -11.7, tradesPer90d: 7.5 },
  { key: 'v1', label: 'نسخه ۱، متعادل (قدیمی)', bear: -11.6, bull: -5.9, dd: -15.3, tradesPer90d: 24 },
];
