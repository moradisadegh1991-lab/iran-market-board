/**
 * Portfolio-level tail risk, measured from the sleeves' own joint history.
 *
 * The allocation engine used to price portfolio risk as w'Σw with a hand-written correlation
 * matrix and a plain normal VaR (1.645·σ·√t). Both understate the number that matters here.
 * In a rial portfolio the dollar, gold, the coin and crypto are all bets on the same thing —
 * the rial — so in the weeks when the rial jumps they move together and the "diversified"
 * portfolio behaves like one position. A fixed matrix cannot see that, and a normal quantile
 * cannot see the jump itself.
 *
 * So the portfolio's daily return series is rebuilt from the sleeves' aligned daily returns.
 * Correlation is then not assumed at all: it is whatever the joint history actually was.
 * The horizon quantile reuses the same machinery the single-asset scenario engine already
 * uses — AR(1) variance ratio, Cornish–Fisher for skew/fat tails, and a blend with the
 * empirical overlapping-window distribution when there is enough of it.
 *
 * Falls back to the assumed matrix (flagged as such) when the aligned history is too short.
 */
import { clamp, isNum } from '@/lib/num';
import { autocorr1, cornishFisher, mean, moments, quantile, std, varianceRatio } from './stats';

export interface ClassSeries {
  dates: string[];
  prices: number[];
}

export interface SleeveInput {
  key: string;
  weight: number; // 0..1
  series: ClassSeries | null;
  /** multiplier on this sleeve's returns — used where a sleeve is proxied by a tamer asset */
  volMult?: number;
  /** constant daily return instead of a series (the fixed-income sleeve) */
  fixedDaily?: number;
}

export interface PortfolioRisk {
  annualVolPct: number | null;
  /** 95% horizon loss, as a positive percentage */
  varPct: number | null;
  /** average loss across the worst 5% of outcomes, as a positive percentage */
  esPct: number | null;
  basis: 'measured' | 'assumed';
  /** aligned trading days the measurement used */
  obs: number;
  /** average pairwise correlation among the risky sleeves actually held */
  avgCorrPct: number | null;
  notes: string[];
}

const Z95 = 1.6449;
const MIN_OBS = 60;
const MIN_SERIES = 80;

/** Daily log returns of every sleeve on the dates where all of them have a price. */
function alignReturns(sleeves: SleeveInput[]): { dates: string[]; rets: number[][] } {
  const withSeries = sleeves.filter((s) => s.series && s.series.prices.length >= MIN_SERIES);
  if (!withSeries.length) return { dates: [], rets: [] };
  const maps = withSeries.map((s) => new Map(s.series!.dates.map((d, i) => [d, s.series!.prices[i]])));
  const common = [...maps[0].keys()].filter((d) => maps.every((m) => isNum(m.get(d)) && m.get(d)! > 0)).sort();
  if (common.length < 2) return { dates: [], rets: [] };
  const rets = maps.map((m) => {
    const out: number[] = [];
    for (let i = 1; i < common.length; i++) out.push(Math.log(m.get(common[i])! / m.get(common[i - 1])!));
    return out;
  });
  return { dates: common, rets };
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

/** Overlapping n-step sums — the empirical distribution of horizon returns. */
function overlapping(r: number[], n: number): number[] {
  if (n <= 1) return [...r];
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    s += r[i];
    if (i >= n) s -= r[i - n];
    if (i >= n - 1) out.push(s);
  }
  return out;
}

/**
 * Mean of the distribution below its 5th percentile (expected shortfall), from the
 * Cornish–Fisher quantile function integrated numerically over the tail.
 */
function cfTailMean(S: number, K: number, sd: number): number {
  const ps = [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05];
  let sum = 0;
  for (const p of ps) sum += cornishFisher(zFor(p), S, K) * sd;
  return sum / ps.length;
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.15e-9). */
function zFor(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -zFor(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * @param horizonDays calendar days of the allocation horizon
 * @param fallback    the assumed-matrix numbers, used when history is too thin to measure
 */
export function portfolioRisk(
  sleeves: SleeveInput[],
  horizonDays: number,
  fallback: { annualVolPct: number | null; varPct: number | null },
): PortfolioRisk {
  const notes: string[] = [];
  const assumed = (why: string): PortfolioRisk => ({
    annualVolPct: fallback.annualVolPct,
    varPct: fallback.varPct,
    // Without a measured distribution the only honest tail estimate is the normal one:
    // ES₉₅/VaR₉₅ = φ(z)/(0.05·z) ≈ 1.2546 for a normal.
    esPct: isNum(fallback.varPct) ? fallback.varPct * 1.2546 : null,
    basis: 'assumed',
    obs: 0,
    avgCorrPct: null,
    notes: [why],
  });

  const risky = sleeves.filter((s) => s.weight > 0.005 && s.series && s.series.prices.length >= MIN_SERIES);
  if (!risky.length) return assumed('تاریخچه مشترک کافی برای اندازه‌گیری نبود؛ اعداد ریسک بر پایه همبستگی‌های فرضی است.');

  const { dates, rets } = alignReturns(risky);
  if (rets.length === 0 || rets[0].length < MIN_OBS) {
    return assumed('تاریخچه هم‌زمان دارایی‌ها کمتر از ۶۰ روز است؛ اعداد ریسک بر پایه همبستگی‌های فرضی است.');
  }

  const obs = rets[0].length;
  const cashWeight = sleeves.filter((s) => !s.series || s.series.prices.length < MIN_SERIES).reduce((a, s) => a + s.weight, 0);
  const cashDaily = sleeves.filter((s) => isNum(s.fixedDaily)).reduce((a, s) => a + s.weight * s.fixedDaily!, 0);

  // the portfolio's own daily return series — correlations enter through the data, not an assumption
  const port: number[] = [];
  for (let t = 0; t < obs; t++) {
    let r = cashDaily;
    for (let i = 0; i < risky.length; i++) r += risky[i].weight * (risky[i].volMult ?? 1) * rets[i][t];
    port.push(r);
  }

  const spanDays = Math.max(1, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000);
  const ppd = clamp((dates.length - 1) / spanDays, 0.4, 1.05);
  const yearPts = Math.round(365 * ppd);
  const sd = std(port);
  if (!isNum(sd) || sd <= 0) return assumed('بازده‌های تاریخی سبد ثابت بود؛ اندازه‌گیری ممکن نشد.');

  const rho = clamp(autocorr1(port), -0.2, 0.4);
  const m = moments(port);
  const S = clamp(m.skew, -1.5, 1.5);
  const K = clamp(m.exKurt, 0, 8);

  const n = Math.max(1, Math.round(horizonDays * ppd));
  const sdN = sd * Math.sqrt(n * varianceRatio(rho, n));
  const Sn = S / Math.sqrt(n);
  const Kn = K / n;

  let q05 = cornishFisher(-Z95, Sn, Kn) * sdN;
  let tail = cfTailMean(Sn, Kn, sdN);

  // where there is enough of it, let the measured distribution speak for part of the answer
  const roll = overlapping(port, n);
  if (roll.length >= Math.max(40, 2 * n + 20)) {
    const w = roll.length >= 5 * n ? 0.5 : 0.3;
    const empQ = quantile(roll, 0.05);
    const worst = [...roll].sort((a, b) => a - b).slice(0, Math.max(1, Math.round(roll.length * 0.05)));
    q05 = (1 - w) * q05 + w * empQ;
    tail = (1 - w) * tail + w * mean(worst);
    notes.push(`دُم توزیع از ${roll.length.toLocaleString('fa-IR')} بازه هم‌پوشان واقعی هم استفاده کرده است.`);
  }
  tail = Math.min(tail, q05); // the tail mean can never be milder than its own 5% quantile

  // average pairwise correlation among the risky sleeves — the diversification the portfolio really has
  const pairs: number[] = [];
  for (let i = 0; i < risky.length; i++) {
    for (let j = i + 1; j < risky.length; j++) {
      const c = correlation(rets[i], rets[j]);
      if (isNum(c)) pairs.push(c);
    }
  }
  const avgCorr = pairs.length ? mean(pairs) : null;
  if (isNum(avgCorr)) {
    notes.push(
      avgCorr > 0.6
        ? `میانگین همبستگی بخش‌های پرریسک ${Math.round(avgCorr * 100).toLocaleString('fa-IR')}٪ است؛ در عمل این سبد تقریباً یک شرط واحد روی تضعیف ریال است و تنوع کمتری از آنچه به‌نظر می‌رسد دارد.`
        : `میانگین همبستگی بخش‌های پرریسک ${Math.round(avgCorr * 100).toLocaleString('fa-IR')}٪ اندازه‌گیری شد (از تاریخچه واقعی، نه فرض).`,
    );
  }
  if (cashWeight > 0.001 && !isNum(cashDaily)) notes.push('سهم درآمد ثابت بدون نوسان فرض شده است.');

  return {
    annualVolPct: sd * Math.sqrt(yearPts) * 100,
    varPct: -(Math.exp(q05) - 1) * 100,
    esPct: -(Math.exp(tail) - 1) * 100,
    basis: 'measured',
    obs,
    avgCorrPct: isNum(avgCorr) ? avgCorr * 100 : null,
    notes,
  };
}
