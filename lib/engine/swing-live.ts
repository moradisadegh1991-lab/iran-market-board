/**
 * Live swing trading on real prices (paper money), for sessions of 1 hour to 1 week.
 *
 * Design note — why this replays the backtester instead of having its own rules:
 * a second, "live" copy of the entry/exit logic would drift from the tested one, and the
 * drift would only show up as unexplained live trades. So every tick re-runs the SAME
 * `runSwing` over the bars confirmed so far, and the session simply mirrors the tail of
 * its trade list. A decision at bar i only ever looks at bars ≤ i, so that list is
 * append-only as bars arrive — past trades never change underneath us.
 * `scripts/swing-live-test.ts` asserts the two stay identical.
 *
 * The still-forming bar is deliberately excluded: including a half-finished candle makes
 * signals appear and vanish as the price wobbles inside the hour.
 */
import { SWING_PRESETS, runSwing, type SwingBar, type SwingPreset, type SwingResult, type SwingTrade } from './swing';

export interface SwingLiveConfig {
  coins: { id: string; symbol: string; name: string }[];
  capitalToman: number;
  preset: SwingPreset;
  feePct: number;
  /** session length in hours, 1 … 168 */
  hours: number;
  usdtRial: number | null;
}

export interface SwingLiveFill extends SwingTrade {
  coinId: string;
  symbol: string;
}

export interface SwingLiveEvent {
  at: number;
  kind: 'start' | 'tick' | 'gap' | 'data' | 'finish';
  text: string;
}

export interface SwingLivePos {
  coinId: string;
  symbol: string;
  entryAt: number;
  entryPrice: number;
  qty: number;
  targetPrice: number;
  stopPrice: number;
  entryReason: string;
  markPrice: number;
  valueToman: number;
  unrealisedPct: number;
}

export interface SwingLiveSession {
  id: string;
  status: 'running' | 'finished';
  startedAt: number;
  endsAt: number;
  finishedAt: number | null;
  endReason: 'expired' | 'stopped' | null;
  config: SwingLiveConfig;
  /** bar resolution actually used, in minutes — depends on session length */
  barMinutes: number;
  sleeveCapitalToman: number;
  ticks: number;
  lastTickAt: number;
  /** Per coin, the state already present in the history when the session started.
   *  Without it the first tick would replay the backtester's historical trades as if they
   *  had just happened (and start the equity curve at the historical P&L, not at capital). */
  baseline: Record<string, { trades: number; value: number }>;
  fills: SwingLiveFill[];
  open: SwingLivePos[];
  equity: { t: number; equity: number }[];
  events: SwingLiveEvent[];
}

const MAX_EVENTS = 120;
const MAX_EQUITY = 600;

/**
 * Bar resolution and how much history to pull.
 * CoinGecko serves 5-minute candles only for a 1-day window and hourly for 2–90 days.
 * The history must be long enough for the preset's slow EMA (runSwing refuses otherwise),
 * which is why short sessions use 5-minute bars: two days of hourly data is only ~48
 * candles, while one day of 5-minute data is ~288.
 */
export function barPlan(hours: number): { days: number; barMinutes: number; minBars: number } {
  if (hours <= 36) return { days: 1, barMinutes: 5, minBars: 200 };
  // enough hourly candles to cover the slowest preset plus the session itself
  return { days: Math.min(90, Math.max(10, Math.ceil(hours / 24) + 4)), barMinutes: 60, minBars: 200 };
}

/** Drop the still-forming bar: only fully closed candles may produce a decision. */
export function confirmedBars(bars: SwingBar[], barMinutes: number, now: number): SwingBar[] {
  const ms = barMinutes * 60_000;
  const cutoff = Math.floor(now / ms) * ms;
  return bars.filter((b) => b.t < cutoff);
}

/**
 * The backtester force-closes any open position at the end of the data with exit 'end'.
 * That is not a real fill — it is the position still being open right now.
 */
function splitTrades(r: SwingResult): { done: SwingTrade[]; openTrade: SwingTrade | null } {
  const ts = r.trades;
  const last = ts[ts.length - 1];
  return last && last.exit === 'end' ? { done: ts.slice(0, -1), openTrade: last } : { done: ts, openTrade: null };
}

export interface SwingLiveInput {
  coin: { id: string; symbol: string; name: string };
  bars: SwingBar[] | null;
  livePrice: number | null;
  error?: string;
}

export function startSwingLive(config: SwingLiveConfig, now: number): SwingLiveSession {
  const { barMinutes } = barPlan(config.hours);
  return {
    id: Math.random().toString(36).slice(2, 10),
    status: 'running',
    startedAt: now,
    endsAt: now + config.hours * 3600_000,
    finishedAt: null,
    endReason: null,
    config,
    barMinutes,
    sleeveCapitalToman: config.capitalToman / Math.max(1, config.coins.length),
    ticks: 0,
    lastTickAt: now,
    baseline: {},
    fills: [],
    open: [],
    equity: [{ t: now, equity: config.capitalToman }],
    events: [
      {
        at: now,
        kind: 'start',
        text: `شروع با ${fa(config.capitalToman)} تومان روی ${fa(config.coins.length, 0)} ارز (${config.coins.map((c) => c.symbol).join('، ')})، سبک ${SWING_PRESETS[config.preset].label}، مدت ${fa(config.hours, 0)} ساعت، کندل ${fa(barMinutes, 0)} دقیقه‌ای.`,
      },
    ],
  };
}

export interface SwingLiveTickResult {
  session: SwingLiveSession;
  newFills: SwingLiveFill[];
}

export function swingLiveTick(session: SwingLiveSession, inputs: SwingLiveInput[], now: number): SwingLiveTickResult {
  const s: SwingLiveSession = { ...session, fills: [...session.fills], events: [...session.events], equity: [...session.equity], baseline: { ...session.baseline } };
  const sleeve = s.sleeveCapitalToman;
  const newFills: SwingLiveFill[] = [];
  const open: SwingLivePos[] = [];
  let total = 0;
  const failed: string[] = [];

  const gapMin = Math.round((now - s.lastTickAt) / 60_000);
  if (s.ticks > 0 && gapMin > Math.max(15, s.barMinutes * 2)) {
    s.events.unshift({ at: now, kind: 'gap', text: `فاصله این بررسی از قبلی ${fa(gapMin, 0)} دقیقه بود؛ در این فاصله قیمت‌ها پایش نشدند.` });
  }

  for (const { coin, bars, livePrice, error } of inputs) {
    if (!bars || error) {
      failed.push(coin.symbol);
      total += sleeve; // its sleeve simply stays in cash
      continue;
    }
    const usable = confirmedBars(bars, s.barMinutes, now);
    let result: SwingResult;
    try {
      result = runSwing(usable, coin, { capitalToman: sleeve, preset: s.config.preset, feePct: s.config.feePct, usdtRial: s.config.usdtRial });
    } catch (e) {
      failed.push(coin.symbol);
      total += sleeve;
      continue;
    }
    const { done, openTrade } = splitTrades(result);

    const firstSeen = s.baseline[coin.id] === undefined;
    const base = s.baseline[coin.id]?.trades ?? done.length;
    // anything beyond what already existed at session start, and that we have not recorded yet
    const already = base + s.fills.filter((f) => f.coinId === coin.id).length;
    for (const t of done.slice(already)) {
      const fill: SwingLiveFill = { ...t, coinId: coin.id, symbol: coin.symbol };
      s.fills.push(fill);
      newFills.push(fill);
    }

    if (openTrade) {
      const mark = livePrice && livePrice > 0 ? livePrice : openTrade.exitPrice;
      const fee = s.config.feePct / 100;
      // Undo the backtester's notional end-of-data close and re-mark at the live price.
      // runSwing sets netIn = committed·(1−fee) and qty = netIn/entryPrice (converted to USD
      // when a tether rate is known), so both the cash left aside and the position's current
      // worth follow from the trade record alone.
      const toToman = (usd: number) => (s.config.usdtRial ? (usd * s.config.usdtRial) / 10 : usd);
      const netIn = toToman(openTrade.qty * openTrade.entryPrice);
      const committed = fee < 1 ? netIn / (1 - fee) : netIn;
      const cashAside = openTrade.equityAfter - (committed + openTrade.pnlToman);
      const grossNow = toToman(openTrade.qty * mark);
      const rawValue = cashAside + grossNow * (1 - fee);
      if (firstSeen) s.baseline[coin.id] = { trades: base, value: rawValue };
      const sleeveValue = sleeve + (rawValue - s.baseline[coin.id].value);
      total += sleeveValue;
      open.push({
        coinId: coin.id,
        symbol: coin.symbol,
        entryAt: openTrade.entryAt,
        entryPrice: openTrade.entryPrice,
        qty: openTrade.qty,
        targetPrice: openTrade.targetPrice,
        stopPrice: openTrade.stopPrice,
        entryReason: openTrade.entryReason,
        markPrice: mark,
        valueToman: sleeveValue,
        unrealisedPct: (mark / openTrade.entryPrice - 1) * 100,
      });
    } else {
      const rawValue = result.metrics.finalEquity;
      if (firstSeen) s.baseline[coin.id] = { trades: base, value: rawValue };
      total += sleeve + (rawValue - s.baseline[coin.id].value);
    }
  }

  if (failed.length) {
    s.events.unshift({ at: now, kind: 'data', text: `داده این ارزها در این بررسی نیامد و سهمشان نقد ماند: ${failed.join('، ')}.` });
  }

  s.open = open;
  s.ticks += 1;
  s.lastTickAt = now;
  s.equity.push({ t: now, equity: total });
  if (s.equity.length > MAX_EQUITY) {
    // keep the newest points at full detail and thin the older ones
    s.equity = [...s.equity.filter((_, i) => i % 2 === 0).slice(0, MAX_EQUITY / 2), ...s.equity.slice(-MAX_EQUITY / 2)];
  }
  if (newFills.length) {
    s.events.unshift({
      at: now,
      kind: 'tick',
      text: `${fa(newFills.length, 0)} معامله ثبت شد: ${newFills.map((f) => `${f.symbol} ${f.exit ? 'فروش' : 'خرید'}`).join('، ')}.`,
    });
  }
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;

  if (now >= s.endsAt) {
    s.status = 'finished';
    s.finishedAt = now;
    s.endReason = 'expired';
    s.events.unshift({ at: now, kind: 'finish', text: `پایان مدت. ارزش نهایی ${fa(total)} تومان.` });
  }

  return { session: s, newFills };
}

export function finishSwingLive(session: SwingLiveSession, now: number, reason: 'stopped' | 'expired'): SwingLiveSession {
  const last = session.equity[session.equity.length - 1]?.equity ?? session.config.capitalToman;
  return {
    ...session,
    status: 'finished',
    finishedAt: now,
    endReason: reason,
    events: [{ at: now, kind: 'finish', text: `${reason === 'stopped' ? 'پایان به دستور کاربر' : 'پایان مدت'}. ارزش نهایی ${fa(last)} تومان.` }, ...session.events],
  };
}

export function swingLiveReturnPct(s: SwingLiveSession): number {
  const last = s.equity[s.equity.length - 1]?.equity ?? s.config.capitalToman;
  return (last / s.config.capitalToman - 1) * 100;
}

const fa = (n: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);
