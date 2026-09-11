// Best / base / worst price scenarios per horizon, with plain-language reasoning.
//
// Method (per asset, per horizon of n trading steps):
//   1. Daily log-returns from the spliced history.
//   2. Volatility σ: short horizons weight recent EWMA vol, long horizons use 1-year sample vol.
//   3. Serial correlation ρ (lag-1) scales multi-day variance by the AR(1) variance ratio
//      VR(n) = 1 + 2·Σ(1−k/n)·ρᵏ — trending markets (ρ>0, e.g. TSE with daily price limits) move further than √n suggests.
//   4. Fat tails: Cornish–Fisher expansion of the 5% / 95% quantiles using skew and excess kurtosis,
//      scaled to the horizon (S/√n, K/n) so tails fade over longer horizons as they do in real data.
//   5. Drift: half the historical mean (shrinkage), capped — past trend is weak evidence of future trend.
//   6. Where enough overlapping history exists, parametric quantiles are blended 50/50 with empirical ones.
//   7. Asset-specific: part of a positive coin/gold bubble is assumed to deflate in the worst case.
// "Worst" = 5th percentile (only 5% of outcomes lower), "best" = 95th percentile, "base" = median.
import { clamp, fmtInt, fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { AssetScenario, HorizonKey, ScenarioGroup, ScenarioRow } from '@/lib/types';
import { autocorr1, ewmaVol, logReturns, mean, median, moments, quantile, rsi, sma, std } from './stats';

export const SCENARIO_HORIZONS: { key: HorizonKey; label: string; days: number }[] = [
  { key: 'd1', label: '۱ روز', days: 1 },
  { key: 'w1', label: '۱ هفته', days: 7 },
  { key: 'm1', label: '۱ ماه', days: 30 },
  { key: 'm3', label: '۳ ماه', days: 90 },
  { key: 'm6', label: '۶ ماه', days: 180 },
  { key: 'y1', label: '۱ سال', days: 365 },
];

const Z95 = 1.6449;
const MIN_RETURNS = 20;

export interface ScenarioInput {
  key: string;
  label: string;
  symbol?: string;
  unit: 'toman' | 'usd' | 'point';
  group: ScenarioGroup;
  price: number | null; // display unit; returns are scale-free
  dates: string[];
  prices: number[];
  basis: string;
  reconstructed?: boolean;
  bubblePct?: number | null;
  context?: string[];
}

const unitTxt = (u: ScenarioInput['unit']) => (u === 'toman' ? ' تومان' : u === 'usd' ? ' دلار' : ' واحد');

function varianceRatio(rho: number, n: number): number {
  if (n <= 1 || Math.abs(rho) < 1e-6) return 1;
  let s = 0;
  let pk = 1;
  const kmax = Math.min(n - 1, 250);
  for (let k = 1; k <= kmax; k++) {
    pk *= rho;
    if (Math.abs(pk) < 1e-6) break;
    s += (1 - k / n) * pk;
  }
  return Math.max(0.3, 1 + 2 * s);
}

const cornishFisher = (z: number, S: number, K: number) =>
  z + ((z * z - 1) * S) / 6 + ((z ** 3 - 3 * z) * K) / 24 - ((2 * z ** 3 - 5 * z) * S * S) / 36;

function rolling(logs: number[], n: number): number[] {
  const out: number[] = [];
  for (let i = n; i < logs.length; i++) out.push(logs[i] - logs[i - n]);
  return out;
}

export function buildScenario(inp: ScenarioInput): AssetScenario {
  const { dates, prices } = inp;
  const rows = Object.fromEntries(SCENARIO_HORIZONS.map((h) => [h.key, null])) as Record<HorizonKey, ScenarioRow | null>;
  const base: AssetScenario = {
    key: inp.key,
    label: inp.label,
    symbol: inp.symbol,
    unit: inp.unit,
    group: inp.group,
    price: inp.price,
    points: prices.length,
    basis: inp.basis,
    annualVolPct: null,
    rows,
    drivers: [],
    summary: '',
  };
  const anchor = isNum(inp.price) && inp.price > 0 ? inp.price : prices[prices.length - 1];
  if (prices.length < MIN_RETURNS + 1 || !isNum(anchor)) {
    base.missingReason = prices.length
      ? `فقط ${fmtInt(prices.length)} روز داده موجود است؛ حداقل ${fmtInt(MIN_RETURNS + 1)} روز لازم است.`
      : 'هنوز هیچ تاریخچه‌ای برای این دارایی در دسترس نیست.';
    return base;
  }

  const spanDays = Math.max(1, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000);
  const ppd = clamp((prices.length - 1) / spanDays, 0.4, 1.05); // TSE ≈ 0.7 steps per calendar day, crypto ≈ 1
  const yearPts = Math.round(365 * ppd);
  const all = logReturns(prices);
  const win = all.slice(-yearPts);
  const logs = prices.map(Math.log);

  const sdLong = std(win);
  const sdShort = Math.sqrt(0.5 * ewmaVol(all) ** 2 + 0.5 * std(all.slice(-60)) ** 2);
  const rho = clamp(autocorr1(win), -0.2, 0.4);
  const mom = moments(win);
  const S = clamp(mom.skew, -1.5, 1.5);
  const K = clamp(mom.exKurt, 0, 8);
  // A year of data estimates trend with a standard error ≈ annual volatility, so drift is halved and capped:
  // rial assets carry real inflation drift (~30%/yr), dollar-priced gold much less, crypto is capped loosely.
  const annualCap = inp.key === 'ons' ? 0.12 : inp.group === 'crypto' || inp.group === 'alt' ? 0.5 : 0.3;
  const driftCap = annualCap / yearPts;
  const mu = clamp(0.5 * mean(win), -driftCap, driftCap);
  const annualVolPct = sdLong * Math.sqrt(yearPts) * 100;
  base.annualVolPct = annualVolPct;

  for (const h of SCENARIO_HORIZONS) {
    const n = Math.max(1, Math.round(h.days * ppd));
    const sd = h.days <= 7 ? sdShort : h.days <= 30 ? 0.5 * sdShort + 0.5 * sdLong : sdLong;
    const sdN = sd * Math.sqrt(n * varianceRatio(rho, n));
    const Sn = S / Math.sqrt(n);
    const Kn = K / n;
    let lo = mu * n + cornishFisher(-Z95, Sn, Kn) * sdN;
    let hi = mu * n + cornishFisher(Z95, Sn, Kn) * sdN;
    let mid = mu * n;

    const roll = rolling(logs, n);
    const histWorstPct = roll.length >= 5 ? (Math.exp(Math.min(...roll)) - 1) * 100 : null;
    const histBestPct = roll.length >= 5 ? (Math.exp(Math.max(...roll)) - 1) * 100 : null;
    if (roll.length >= Math.max(40, 2 * n + 20)) {
      const w = roll.length >= 5 * n ? 0.5 : 0.3;
      lo = (1 - w) * lo + w * quantile(roll, 0.05);
      hi = (1 - w) * hi + w * quantile(roll, 0.95);
      mid = (1 - w) * mid + w * clamp(median(roll), mu * n - sdN, mu * n + sdN);
    }
    if (isNum(inp.bubblePct) && inp.bubblePct > 2 && h.days >= 30) {
      lo += Math.log(1 - 0.5 * (inp.bubblePct / 100) * Math.min(1, h.days / 180));
    }
    lo = Math.min(lo, mid - 1e-4);
    hi = Math.max(hi, mid + 1e-4);

    const need = Math.min(yearPts, 4 * n + 40);
    const confidence = clamp(all.length / need, 0, 1) * (inp.reconstructed ? 0.85 : 1);
    rows[h.key] = {
      h: h.key,
      label: h.label,
      days: h.days,
      worst: anchor * Math.exp(lo),
      base: anchor * Math.exp(mid),
      best: anchor * Math.exp(hi),
      worstPct: (Math.exp(lo) - 1) * 100,
      basePct: (Math.exp(mid) - 1) * 100,
      bestPct: (Math.exp(hi) - 1) * 100,
      histWorstPct,
      histBestPct,
      confidence,
    };
  }

  // ── plain-language reasoning ──
  const d: string[] = [];
  const monthMove = sdLong * Math.sqrt(Math.round(30 * ppd) * varianceRatio(rho, Math.round(30 * ppd))) * 100;
  d.push(`نوسان سالانه ${fmtPct(annualVolPct, 0, false)} است؛ یعنی جابه‌جایی «عادی» قیمت در یک ماه حدود ${fmtPct(monthMove, 0, false)} به بالا یا پایین است. بازه سناریوها از همین عدد ساخته شده.`);

  const last = prices[prices.length - 1];
  const back = Math.round(90 * ppd);
  const r90 = prices.length > back ? (last / prices[prices.length - 1 - back] - 1) * 100 : null;
  const s50 = sma(prices, Math.min(50, prices.length));
  if (isNum(r90) && isNum(s50)) {
    const above = last >= s50;
    d.push(
      `روند: بازده ۳ ماه اخیر ${fmtPct(r90, 0)} و قیمت ${above ? 'بالای' : 'زیر'} میانگین ۵۰ روزه است. ` +
        (above && r90 > 0
          ? 'روند صعودی است، اما در محاسبه فقط نیمی از روند گذشته به آینده منتقل شده (گذشته تضمین آینده نیست).'
          : !above && r90 < 0
            ? 'روند نزولی است؛ سناریوی پایه به همین دلیل کمی محتاطانه‌تر شده.'
            : 'روند مشخصی وجود ندارد.'),
    );
  }
  const rs = rsi(prices, 14);
  if (isNum(rs) && (rs >= 70 || rs <= 30))
    d.push(
      rs >= 70
        ? `شاخص RSI برابر ${fmtInt(rs)} است (بالای ۷۰ = خرید هیجانی)؛ در کوتاه‌مدت احتمال اصلاح قیمت بیشتر از حالت عادی است.`
        : `شاخص RSI برابر ${fmtInt(rs)} است (زیر ۳۰ = فروش هیجانی)؛ در کوتاه‌مدت احتمال برگشت قیمت بیشتر از حالت عادی است.`,
    );
  const hi1y = Math.max(...prices.slice(-yearPts));
  const dd = (last / hi1y - 1) * 100;
  if (dd <= -10) d.push(`قیمت ${fmtPct(-dd, 0, false)} پایین‌تر از سقف یک سال اخیر است.`);
  if (K >= 2)
    d.push(`«دُم پهن»: کشیدگی بازده‌ها ${fmtInt(mom.exKurt)} است (در توزیع نرمال صفر). یعنی جهش‌های ناگهانی بیش از حد عادی رخ داده؛ برای همین سناریوهای کوتاه‌مدت بازتر شده‌اند.`);
  if (rho >= 0.1)
    d.push(`بازده‌های روزانه به هم وابسته‌اند (همبستگی ${fmtPct(rho * 100, 0, false)})؛ حرکت‌ها ادامه‌دار است و در افق‌های بلند، نوسان بیشتر از جمع ساده نوسان روزانه در نظر گرفته شده.`);
  else if (rho <= -0.1)
    d.push(`بازده‌های روزانه تمایل به برگشت دارند (همبستگی ${fmtPct(rho * 100, 0)})؛ در افق‌های بلند بازه کمی جمع‌تر شده.`);
  const m1 = rows.m1;
  if (m1 && isNum(m1.histWorstPct) && isNum(m1.histBestPct))
    d.push(`در تاریخچه موجود، بدترین یک ماه ${fmtPct(m1.histWorstPct, 0)} و بهترین یک ماه ${fmtPct(m1.histBestPct, 0)} بوده است.`);
  if (isNum(inp.bubblePct) && inp.bubblePct > 2)
    d.push(`حباب ${fmtPct(inp.bubblePct, 1, false)} نسبت به ارزش ذاتی وجود دارد؛ در سناریوی بدبینانه فرض شده نیمی از آن طی ۶ ماه تخلیه شود.`);
  d.push(...(inp.context ?? []));
  d.push(
    `مبنا: ${fmtInt(prices.length)} روز داده (${inp.basis})${inp.reconstructed ? '؛ بخشی از تاریخچه با داده جایگزین بازسازی شده و اعتماد کمتری دارد' : ''}.`,
  );
  base.drivers = d;
  if (m1)
    base.summary = `در یک ماه آینده، با احتمال ۹۰٪ قیمت بین ${fmtPrice(m1.worst)} و ${fmtPrice(m1.best)}${unitTxt(inp.unit)} است؛ سناریوی میانه ${fmtPrice(m1.base)}${unitTxt(inp.unit)}.`;
  return base;
}

/** Correlation of n-step log returns between two date→price maps (common dates only). */
export function returnCorrelation(a: Map<string, number>, b: Map<string, number>, n = 20): number | null {
  const dates = [...a.keys()].filter((d) => b.has(d)).sort();
  if (dates.length < n * 3 + 10) return null;
  const ra: number[] = [], rb: number[] = [];
  for (let i = n; i < dates.length; i += n) {
    ra.push(Math.log(a.get(dates[i])! / a.get(dates[i - n])!));
    rb.push(Math.log(b.get(dates[i])! / b.get(dates[i - n])!));
  }
  if (ra.length < 5) return null;
  const ma = mean(ra), mb = mean(rb);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < ra.length; i++) {
    sab += (ra[i] - ma) * (rb[i] - mb);
    saa += (ra[i] - ma) ** 2;
    sbb += (rb[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

/** Beta and vol ratio of an asset vs a benchmark from daily returns on common dates. */
export function betaVs(asset: Map<string, number>, bench: Map<string, number>): { beta: number; volRatio: number } | null {
  const dates = [...asset.keys()].filter((d) => bench.has(d)).sort();
  if (dates.length < 60) return null;
  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    ra.push(Math.log(asset.get(dates[i])! / asset.get(dates[i - 1])!));
    rb.push(Math.log(bench.get(dates[i])! / bench.get(dates[i - 1])!));
  }
  const mb = mean(rb), ma = mean(ra);
  let cov = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    vb += (rb[i] - mb) ** 2;
  }
  const sb = std(rb);
  return vb > 0 && sb > 0 ? { beta: cov / vb, volRatio: std(ra) / sb } : null;
}
