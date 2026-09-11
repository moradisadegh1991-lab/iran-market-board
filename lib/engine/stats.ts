export function logReturns(p: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < p.length; i++) if (p[i] > 0 && p[i - 1] > 0) r.push(Math.log(p[i] / p[i - 1]));
  return r;
}

export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/** RiskMetrics EWMA volatility (per period) */
export function ewmaVol(r: number[], lambda = 0.94): number {
  if (!r.length) return 0;
  let v = r.slice(0, Math.min(10, r.length)).reduce((s, x) => s + x * x, 0) / Math.min(10, r.length);
  for (const x of r) v = lambda * v + (1 - lambda) * x * x;
  return Math.sqrt(v);
}

/** Wilder RSI */
export function rsi(p: number[], period = 14): number | null {
  if (p.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = p[i] - p[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < p.length; i++) {
    const d = p[i] - p[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export const sma = (p: number[], n: number) => (p.length >= n ? mean(p.slice(-n)) : null);

export function maxDrawdown(p: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const x of p) {
    peak = Math.max(peak, x);
    if (peak > 0) mdd = Math.min(mdd, x / peak - 1);
  }
  return mdd;
}

/** standard normal CDF (Abramowitz–Stegun 7.1.26) */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** OLS on y vs index → slope per step and R² */
export function linreg(y: number[]): { slope: number; r2: number } {
  const n = y.length;
  if (n < 3) return { slope: 0, r2: 0 };
  const xm = (n - 1) / 2, ym = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - xm) * (y[i] - ym);
    sxx += (i - xm) ** 2;
    syy += (y[i] - ym) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, r2 };
}

/** percentile rank 0..1 (NaN → 0.5, ties averaged) */
export function pctRank(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const out = values.map(() => 0.5);
  const n = idx.length;
  if (n <= 1) return out;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
