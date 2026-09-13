/**
 * Runs the swing engine on several coins at once as one portfolio.
 *
 * Each coin gets its own equal sleeve of the capital and is traded independently — the
 * sleeves never lend to each other, so a loss on one coin cannot be covered by another's
 * cash. That keeps every per-coin result identical to running it alone with capital/N,
 * which is what makes the combined curve honest: it is a real equal-weight portfolio,
 * not N overlapping full-capital backtests added together (a common way to fake a
 * multiple-of-reality return).
 */
import { maxDrawdown } from './stats';
import { runSwing, type SwingConfig, type SwingResult, type SwingBar } from './swing';

export interface SwingSleeve {
  coin: { id: string; symbol: string; name: string };
  ok: boolean;
  error?: string;
  result?: SwingResult;
}

export interface SwingPortfolio {
  sleeves: SwingSleeve[];
  /** how many coins actually traded (the rest failed to load or had too little history) */
  used: number;
  sleeveCapitalToman: number;
  combined: {
    startEquity: number;
    finalEquity: number;
    pnlToman: number;
    returnPct: number;
    /** equal-weight buy & hold over the same sleeves, for comparison */
    buyHoldPct: number | null;
    trades: number;
    wins: number;
    winRatePct: number | null;
    maxDrawdownPct: number;
    feesToman: number;
    /** share of sleeve-hours that were actually holding a position */
    timeInMarketPct: number | null;
    from: number | null;
    to: number | null;
  };
  /** combined equity over the union of timestamps (sleeves forward-filled) */
  equity: { t: number; equity: number }[];
  best: { symbol: string; returnPct: number } | null;
  worst: { symbol: string; returnPct: number } | null;
  warnings: string[];
}

/**
 * Combine per-sleeve equity curves onto the union of their timestamps.
 * A sleeve that has not started yet contributes its untouched cash, and one whose data
 * ended early keeps its last value — otherwise the portfolio curve would jump purely
 * because a coin's history is shorter.
 */
function combineEquity(
  curves: { t: number; equity: number }[][],
  sleeveCapital: number,
): { t: number; equity: number }[] {
  const stamps = [...new Set(curves.flat().map((p) => p.t))].sort((a, b) => a - b);
  if (!stamps.length) return [];
  const idx = curves.map(() => 0);
  const last = curves.map(() => sleeveCapital);
  const out: { t: number; equity: number }[] = [];
  for (const t of stamps) {
    let total = 0;
    for (let c = 0; c < curves.length; c++) {
      const curve = curves[c];
      while (idx[c] < curve.length && curve[idx[c]].t <= t) {
        last[c] = curve[idx[c]].equity;
        idx[c]++;
      }
      total += last[c];
    }
    out.push({ t, equity: total });
  }
  return out;
}

export function runSwingPortfolio(
  inputs: { coin: { id: string; symbol: string; name: string }; bars: SwingBar[] | null; error?: string }[],
  config: Omit<SwingConfig, 'capitalToman'> & { capitalToman: number },
): SwingPortfolio {
  const warnings: string[] = [];
  if (!inputs.length) throw new Error('هیچ ارزی انتخاب نشده است.');

  const sleeveCapital = config.capitalToman / inputs.length;
  const sleeves: SwingSleeve[] = inputs.map(({ coin, bars, error }) => {
    if (!bars || error) return { coin, ok: false, error: error ?? 'تاریخچه‌ای دریافت نشد.' };
    try {
      const result = runSwing(bars, coin, { ...config, capitalToman: sleeveCapital });
      return { coin, ok: true, result };
    } catch (e) {
      return { coin, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const good = sleeves.filter((s): s is SwingSleeve & { result: SwingResult } => s.ok && !!s.result);
  const failed = sleeves.filter((s) => !s.ok);
  if (failed.length) {
    warnings.push(
      `${failed.length.toLocaleString('fa-IR')} ارز از محاسبه کنار گذاشته شد (${failed.map((f) => f.coin.symbol).join('، ')}). ` +
        'سرمایه سهم آن‌ها نقد فرض شده و در بازده کل اثر خنثی دارد.',
    );
  }
  if (!good.length) throw new Error('برای هیچ‌کدام از ارزهای انتخاب‌شده داده ساعتی کافی نبود.');

  // A sleeve's equity curve is marked-to-market, but finalEquity is the cash AFTER the
  // end-of-data close pays its exit fee. Without this last point the combined curve ends
  // slightly above the money actually realised.
  const curves = good.map((s) => {
    const pts = s.result.equity.map((e) => ({ t: e.t, equity: e.equity }));
    const lastT = pts.length ? pts[pts.length - 1].t : 0;
    return [...pts.slice(0, -1), { t: lastT, equity: s.result.metrics.finalEquity }];
  });
  const equity = combineEquity(curves, sleeveCapital);
  // sleeves that never ran keep their cash for the whole window
  const idleCash = sleeveCapital * failed.length;
  const withIdle = equity.map((p) => ({ t: p.t, equity: p.equity + idleCash }));

  const finalEquity = withIdle.length ? withIdle[withIdle.length - 1].equity : config.capitalToman;
  const trades = good.reduce((a, s) => a + s.result.trades.length, 0);
  const wins = good.reduce((a, s) => a + s.result.trades.filter((t) => t.pnlToman > 0).length, 0);
  const feesToman = good.reduce((a, s) => a + s.result.metrics.feesToman, 0);

  // equal-weight buy & hold across the sleeves that ran, plus idle cash for the rest
  const bhSleeve = good.reduce((a, s) => a + sleeveCapital * (1 + s.result.metrics.buyHoldPct / 100), 0) + idleCash;
  const buyHoldPct = (bhSleeve / config.capitalToman - 1) * 100;

  const timeVals = good.map((s) => s.result.metrics.timeInMarketPct).filter((v) => Number.isFinite(v));
  const rets = good.map((s) => ({ symbol: s.coin.symbol, returnPct: s.result.metrics.returnPct })).sort((a, b) => b.returnPct - a.returnPct);

  if (good.length === 1) warnings.push('فقط یک ارز محاسبه شد؛ این نتیجه تنوع سبد ندارد.');

  return {
    sleeves,
    used: good.length,
    sleeveCapitalToman: sleeveCapital,
    combined: {
      startEquity: config.capitalToman,
      finalEquity,
      pnlToman: finalEquity - config.capitalToman,
      returnPct: (finalEquity / config.capitalToman - 1) * 100,
      buyHoldPct,
      trades,
      wins,
      winRatePct: trades ? (wins / trades) * 100 : null,
      maxDrawdownPct: maxDrawdown(withIdle.map((p) => p.equity)) * 100,
      feesToman,
      timeInMarketPct: timeVals.length ? timeVals.reduce((a, v) => a + v, 0) / timeVals.length : null,
      from: withIdle.length ? withIdle[0].t : null,
      to: withIdle.length ? withIdle[withIdle.length - 1].t : null,
    },
    equity: withIdle,
    best: rets[0] ?? null,
    worst: rets.length > 1 ? rets[rets.length - 1] : null,
    warnings,
  };
}
