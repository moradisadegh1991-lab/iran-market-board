// Horizon risk model (transparent, not a price forecast)
//   h-day log return ~ N(μ·h, σ²·h), μ = 0.5 × historical mean (shrinkage), σ = sample / EWMA blend
//   P_down = P(return ≤ −k_h),  P_up = P(return ≥ +k_h)
//   Overextension O ∈ [−1, 1] from RSI & z-score of log-price vs its window mean
//   buy  = 0.50·(P_down/0.5) + 0.35·(O+1)/2 + 0.15·MDDnorm   (+ asset-specific add-on, e.g. coin bubble)
//   hold = 0.65·(P_down/0.5) + 0.35·MDDnorm
//   sell = 0.60·(P_up/0.5)   + 0.40·(1−O)/2                   (regret risk of selling now)
import { clamp } from '@/lib/num';
import type { HorizonKey, HorizonRisk } from '@/lib/types';
import { ewmaVol, logReturns, maxDrawdown, mean, normCdf, rsi, std } from './stats';

export const HORIZONS: { key: HorizonKey; label: string; days: number; window: number; k: number }[] = [
  { key: 'd1', label: 'روزانه', days: 1, window: 30, k: 0.02 },
  { key: 'w1', label: 'هفتگی', days: 7, window: 60, k: 0.04 },
  { key: 'm1', label: 'ماهانه', days: 30, window: 120, k: 0.08 },
  { key: 'm3', label: '۳ ماهه', days: 90, window: 250, k: 0.12 },
  { key: 'm6', label: '۶ ماهه', days: 180, window: 365, k: 0.18 },
  { key: 'y1', label: 'سالانه', days: 365, window: 400, k: 0.25 },
];

const MIN_POINTS = 20;

function daysBetween(a: string, b: string) {
  return Math.max(1, (Date.parse(b) - Date.parse(a)) / 86400000);
}

export function computeRisk(
  dates: string[],
  prices: number[],
  buyAddOn = 0,
): { horizons: Record<HorizonKey, HorizonRisk | null>; annualVolPct: number | null } {
  const empty = Object.fromEntries(HORIZONS.map((h) => [h.key, null])) as Record<HorizonKey, HorizonRisk | null>;
  const n = prices.length;
  if (n < MIN_POINTS) return { horizons: empty, annualVolPct: null };

  const span = daysBetween(dates[0], dates[n - 1]);
  const ppd = clamp((n - 1) / span, 0.4, 1.05); // points per calendar day (TSE ≈ 0.7, crypto ≈ 1)
  const allRet = logReturns(prices);
  const annualVolPct = std(allRet.slice(-Math.round(365 * ppd))) * Math.sqrt(365 * ppd) * 100;
  const last = prices[n - 1];

  for (const h of HORIZONS) {
    const wPts = Math.max(MIN_POINTS, Math.round(h.window * ppd));
    const used = prices.slice(-wPts);
    if (used.length < MIN_POINTS) continue;
    const r = logReturns(used);
    const hPts = Math.max(1, h.days * ppd);
    const sampleSd = std(r);
    const sd = h.days <= 7 ? Math.sqrt(0.5 * ewmaVol(r) ** 2 + 0.5 * sampleSd ** 2) : sampleSd;
    const mu = 0.5 * mean(r);
    const m = mu * hPts;
    const s = Math.max(sd * Math.sqrt(hPts), 1e-6);

    const pDown = normCdf((Math.log(1 - h.k) - m) / s);
    const pUp = 1 - normCdf((Math.log(1 + h.k) - m) / s);

    const logs = used.map(Math.log);
    const zWin = h.days <= 7 ? logs.slice(-20) : logs;
    const zsd = std(zWin);
    const z = zsd > 0 ? (Math.log(last) - mean(zWin)) / zsd : 0;
    const zComp = clamp(z / 2, -1, 1);
    const rs = rsi(used, 14);
    const rsiComp = rs === null ? 0 : clamp((rs - 50) / 30, -1, 1);
    const O = h.days <= 7 ? 0.6 * rsiComp + 0.4 * zComp : h.days <= 90 ? 0.4 * rsiComp + 0.6 * zComp : zComp;

    const mddN = clamp(Math.abs(maxDrawdown(used)) / (2 * h.k), 0, 1);
    const pd = clamp(pDown / 0.5, 0, 1);
    const pu = clamp(pUp / 0.5, 0, 1);

    const buy = Math.round(clamp(100 * (0.5 * pd + 0.35 * (O + 1) / 2 + 0.15 * mddN) + buyAddOn, 0, 100));
    const hold = Math.round(clamp(100 * (0.65 * pd + 0.35 * mddN), 0, 100));
    const sell = Math.round(clamp(100 * (0.6 * pu + 0.4 * (1 - O) / 2), 0, 100));
    const z80 = 1.2816;

    empty[h.key] = {
      buy,
      hold,
      sell,
      pDown,
      pUp,
      expReturnPct: (Math.exp(m) - 1) * 100,
      rangeLow: last * Math.exp(m - z80 * s),
      rangeHigh: last * Math.exp(m + z80 * s),
      confidence: clamp(used.length / wPts, 0, 1) * clamp(span / Math.min(h.window, 365), 0.3, 1),
      signal: buy <= 35 && sell >= 55 ? 'entry-low' : buy >= 65 ? 'entry-high' : 'neutral',
    };
  }
  return { horizons: empty, annualVolPct: Number.isFinite(annualVolPct) ? annualVolPct : null };
}

export function riskLevel(score: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (score === null || score === undefined || !Number.isFinite(score)) return 2;
  if (score < 25) return 0;
  if (score < 45) return 1;
  if (score < 60) return 2;
  if (score < 75) return 3;
  return 4;
}

export const RISK_LEVEL_LABEL = ['کم', 'نسبتاً کم', 'متوسط', 'زیاد', 'خیلی زیاد'] as const;
