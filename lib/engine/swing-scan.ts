/**
 * Picks which coins to swing-trade, automatically, from real market data.
 *
 * The obvious approach — backtest everything over the last N days and keep the best
 * performers — is the classic way to fool yourself: the winners of a window are largely the
 * coins that happened to trend in that window, and the ranking does not survive into the
 * next one. So the scan is split in two:
 *
 *   1. SELECTION on the older half of the history (in-sample). Coins are ranked by how well
 *      they behaved for a swing strategy, not by raw return.
 *   2. VALIDATION on the newer half, which the ranking never saw (out-of-sample).
 *
 * Both numbers are reported. If the out-of-sample result is far below the in-sample one, the
 * selection did not generalise — and the caller is told so rather than shown only the
 * flattering half.
 */
import { runSwing, type SwingBar, type SwingConfig, type SwingResult } from './swing';
import { PRIOR_WEIGHT, type CoinPrior } from '@/lib/swing-history';

export interface ScanCandidate {
  coin: { id: string; symbol: string; name: string; meme?: boolean };
  ok: boolean;
  reason?: string;
  /** chosen on the older half */
  inSample?: { returnPct: number; trades: number; winRatePct: number | null; maxDrawdownPct: number; score: number };
  /** what past recorded runs of this coin say, and how much it moved the score */
  prior?: { runs: number; meanEdgePct: number; adjustment: number };
  /** measured on the newer half, unseen by the ranking */
  outSample?: { returnPct: number; buyHoldPct: number; trades: number; winRatePct: number | null; maxDrawdownPct: number };
  selected: boolean;
}

export interface SwingScan {
  candidates: ScanCandidate[];
  selected: ScanCandidate[];
  /** equal-weight out-of-sample return of the selected basket */
  outSampleReturnPct: number | null;
  /** same for every candidate — the benchmark the selection has to beat to be worth anything */
  allCandidatesReturnPct: number | null;
  outSampleBuyHoldPct: number | null;
  splitAt: number | null;
  verdict: string;
  warnings: string[];
}

const MIN_TRADES = 4;

/**
 * Swing-suitability score on the in-sample half.
 * Return alone would crown whatever trended hardest, so it is divided by the drawdown it
 * took to get there and only counted when the strategy actually traded enough times for the
 * number to mean anything.
 */
function score(r: SwingResult): number {
  const m = r.metrics;
  if (m.trades < MIN_TRADES) return -Infinity;
  const dd = Math.max(Math.abs(m.maxDrawdownPct), 3); // floor so a tiny-drawdown fluke can't dominate
  const perTrade = m.returnPct / m.trades;
  // return per unit of pain, nudged by consistency; capped so one huge trade can't carry it
  return (m.returnPct / dd) * 1 + Math.max(-2, Math.min(2, perTrade)) * 0.25;
}

function half(bars: SwingBar[]): { train: SwingBar[]; test: SwingBar[]; splitAt: number } {
  const cut = Math.floor(bars.length / 2);
  return { train: bars.slice(0, cut), test: bars.slice(cut), splitAt: bars[cut]?.t ?? 0 };
}

export function scanSwing(
  inputs: { coin: ScanCandidate['coin']; bars: SwingBar[] | null; error?: string }[],
  config: Omit<SwingConfig, 'capitalToman'> & { capitalToman: number },
  pick: number,
  priors?: Map<string, CoinPrior>,
): SwingScan {
  const warnings: string[] = [];
  const candidates: ScanCandidate[] = [];

  for (const { coin, bars, error } of inputs) {
    if (!bars || error) {
      candidates.push({ coin, ok: false, reason: error ?? 'تاریخچه دریافت نشد', selected: false });
      continue;
    }
    const { train, test, splitAt } = half(bars);
    try {
      const tr = runSwing(train, coin, { ...config, capitalToman: config.capitalToman });
      const te = runSwing(test, coin, { ...config, capitalToman: config.capitalToman });
      let sc = score(tr);
      const pr = priors?.get(coin.id);
      let priorInfo: ScanCandidate['prior'];
      if (Number.isFinite(sc) && pr && pr.runs > 0) {
        // history nudges the ranking; it never replaces what this window's data says
        const adj = pr.score * PRIOR_WEIGHT;
        sc += adj;
        priorInfo = { runs: pr.runs, meanEdgePct: pr.meanEdgePct, adjustment: adj };
      }
      candidates.push({
        coin,
        ok: Number.isFinite(sc),
        reason: Number.isFinite(sc) ? undefined : `در نیمه اول فقط ${tr.metrics.trades.toLocaleString('fa-IR')} معامله داشت؛ برای قضاوت کافی نیست`,
        inSample: { returnPct: tr.metrics.returnPct, trades: tr.metrics.trades, winRatePct: tr.metrics.winRatePct, maxDrawdownPct: tr.metrics.maxDrawdownPct, score: sc },
        prior: priorInfo,
        outSample: { returnPct: te.metrics.returnPct, buyHoldPct: te.metrics.buyHoldPct, trades: te.metrics.trades, winRatePct: te.metrics.winRatePct, maxDrawdownPct: te.metrics.maxDrawdownPct },
        selected: false,
        // splitAt captured below
      });
      (candidates[candidates.length - 1] as any)._splitAt = splitAt;
    } catch (e) {
      candidates.push({ coin, ok: false, reason: e instanceof Error ? e.message : String(e), selected: false });
    }
  }

  const usable = candidates.filter((c) => c.ok && c.inSample && Number.isFinite(c.inSample.score));
  if (!usable.length) throw new Error('هیچ ارزی داده کافی برای غربال نداشت.');

  usable.sort((a, b) => b.inSample!.score - a.inSample!.score);
  const chosen = usable.slice(0, Math.max(1, pick));
  for (const c of chosen) c.selected = true;

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
  const outSampleReturnPct = mean(chosen.map((c) => c.outSample!.returnPct));
  const allCandidatesReturnPct = mean(usable.map((c) => c.outSample!.returnPct));
  const outSampleBuyHoldPct = mean(chosen.map((c) => c.outSample!.buyHoldPct));
  const inSampleMean = mean(chosen.map((c) => c.inSample!.returnPct));

  // Did picking actually help, or would any of these coins have done as well?
  let verdict: string;
  if (outSampleReturnPct === null || allCandidatesReturnPct === null) {
    verdict = 'داده کافی برای داوری درباره کیفیت انتخاب نبود.';
  } else {
    const edge = outSampleReturnPct - allCandidatesReturnPct;
    const decay = (inSampleMean ?? 0) - outSampleReturnPct;
    const parts: string[] = [];
    parts.push(
      edge > 1
        ? `انتخاب خودکار در نیمه دومِ دیده‌نشده ${fa(edge)} واحد درصد بهتر از میانگین همه نامزدها عمل کرد.`
        : edge < -1
          ? `انتخاب خودکار در نیمه دومِ دیده‌نشده ${fa(Math.abs(edge))} واحد درصد بدتر از میانگین همه نامزدها بود؛ یعنی این غربال در این بازه ارزش افزوده‌ای نداشت.`
          : 'انتخاب خودکار در نیمه دوم تقریباً هم‌اندازه میانگین همه نامزدها بود؛ یعنی غربال مزیت روشنی نساخت.',
    );
    if (decay > 10) parts.push(`فاصله نتیجه نیمه اول و نیمه دوم ${fa(decay)} واحد درصد است — نشانه معمول بیش‌برازش به گذشته.`);
    verdict = parts.join(' ');
  }

  const failed = candidates.filter((c) => !c.ok);
  if (failed.length) warnings.push(`${fa(failed.length, 0)} ارز کنار گذاشته شد: ${failed.map((f) => f.coin.symbol).join('، ')}.`);
  warnings.push('این غربال بر پایه رفتار گذشته است. حتی وقتی نیمه دوم خوب از کار درمی‌آید، تضمینی برای بازه بعدی نیست.');

  return {
    candidates,
    selected: chosen,
    outSampleReturnPct,
    allCandidatesReturnPct,
    outSampleBuyHoldPct,
    splitAt: (chosen[0] as any)?._splitAt ?? null,
    verdict,
    warnings,
  };
}

const fa = (n: number, digits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);
