// Chart indicators for /charts — the pure half.
//
// The usual trader's set: simple moving averages 20/50/200, EMA 20, Bollinger bands (20, 2σ),
// RSI 14 (Wilder) and MACD 12/26/9. They are computed on the whole series the chart has — including
// the warm-up history before the visible window (/api/chart?warm=1), so a 200-day average exists on
// the first visible day instead of starting halfway through the chart — and then cut to the window.
//
// What they say is described, not sold: `readings` turns the last values into plain sentences, and
// `INDICATOR_EVIDENCE` is what this project measured about such signals on real Iranian prices
// (CLAUDE.md rules 25–28) — the page shows it next to them.
import { emaSeries, rsiSeries } from './engine/stats';

export type IndicatorKey = 'ma20' | 'ma50' | 'ma200' | 'ema20' | 'bb' | 'rsi' | 'macd';

export const INDICATORS: { key: IndicatorKey; label: string; pane: boolean }[] = [
  { key: 'ma20', label: 'میانگین ۲۰', pane: false },
  { key: 'ma50', label: 'میانگین ۵۰', pane: false },
  { key: 'ma200', label: 'میانگین ۲۰۰', pane: false },
  { key: 'ema20', label: 'EMA ۲۰', pane: false },
  { key: 'bb', label: 'بولینگر', pane: false },
  { key: 'rsi', label: 'RSI', pane: true },
  { key: 'macd', label: 'MACD', pane: true },
];

/** Line colours (with the price line's lapis/green/red they stay distinct, also for colour-blind eyes). */
export const IND_COLOR: Record<string, string> = {
  ma20: '#D9A02A',
  ma50: '#0D7377',
  ma200: '#7A4FB5',
  ema20: '#C2410C',
  bb: '#8A94A6',
  rsi: '#7A4FB5',
  macd: '#0D7377',
  signal: '#D9A02A',
};

type Vals = (number | null)[];

export function smaSeries(p: number[], n: number): Vals {
  const out: Vals = p.map(() => null);
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    s += p[i];
    if (i >= n) s -= p[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** Middle = SMA(n); bands = middle ± k × population standard deviation of the same n closes. */
export function bollinger(p: number[], n = 20, k = 2): { mid: Vals; upper: Vals; lower: Vals } {
  const mid = smaSeries(p, n);
  const upper: Vals = p.map(() => null);
  const lower: Vals = p.map(() => null);
  for (let i = n - 1; i < p.length; i++) {
    const m = mid[i]!;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (p[j] - m) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

/** MACD = EMA(fast) − EMA(slow); signal = EMA(signal) of MACD; histogram = MACD − signal. */
export function macd(p: number[], fast = 12, slow = 26, sig = 9): { macd: Vals; signal: Vals; hist: Vals } {
  const ef = emaSeries(p, fast);
  const es = emaSeries(p, slow);
  const line: Vals = p.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i]! - es[i]! : null));
  const start = line.findIndex((x) => x !== null);
  const signal: Vals = p.map(() => null);
  if (start >= 0) {
    const tail = emaSeries(line.slice(start) as number[], sig);
    tail.forEach((v, j) => (signal[start + j] = v));
  }
  const hist: Vals = line.map((m, i) => (m !== null && signal[i] !== null ? m - signal[i]! : null));
  return { macd: line, signal, hist };
}

export interface IndicatorLines {
  /** drawn on the price pane: [ms, value|null] aligned with the visible points */
  overlays: { key: string; label: string; color: string; dashed?: boolean; points: [number, number | null][] }[];
  rsi: [number, number | null][] | null;
  macd: { macd: [number, number | null][]; signal: [number, number | null][]; hist: [number, number | null][] } | null;
}

/**
 * The chosen indicators over `warmup` + `points` (both [ms, close], ascending), cut to `points`.
 * A value is null until its window is full — never padded or extrapolated.
 */
export function computeIndicators(points: [number, number][], warmup: [number, number][], keys: IndicatorKey[]): IndicatorLines {
  const all = [...warmup.filter(([t]) => t < (points[0]?.[0] ?? Infinity)), ...points];
  const closes = all.map((p) => p[1]);
  const off = all.length - points.length;
  const cut = (v: Vals): [number, number | null][] => points.map(([t], i) => [t, v[off + i] ?? null]);
  const out: IndicatorLines = { overlays: [], rsi: null, macd: null };
  for (const k of keys) {
    if (k === 'ma20' || k === 'ma50' || k === 'ma200') {
      const n = +k.slice(2);
      out.overlays.push({ key: k, label: INDICATORS.find((x) => x.key === k)!.label, color: IND_COLOR[k], points: cut(smaSeries(closes, n)) });
    } else if (k === 'ema20') out.overlays.push({ key: k, label: 'EMA ۲۰', color: IND_COLOR.ema20, points: cut(emaSeries(closes, 20)) });
    else if (k === 'bb') {
      const b = bollinger(closes);
      out.overlays.push({ key: 'bb-up', label: 'بولینگر بالا', color: IND_COLOR.bb, dashed: true, points: cut(b.upper) });
      out.overlays.push({ key: 'bb-mid', label: 'بولینگر میانه', color: IND_COLOR.bb, points: cut(b.mid) });
      out.overlays.push({ key: 'bb-low', label: 'بولینگر پایین', color: IND_COLOR.bb, dashed: true, points: cut(b.lower) });
    } else if (k === 'rsi') out.rsi = cut(rsiSeries(closes, 14));
    else if (k === 'macd') {
      const m = macd(closes);
      out.macd = { macd: cut(m.macd), signal: cut(m.signal), hist: cut(m.hist) };
    }
  }
  return out;
}

const last = (xs: [number, number | null][] | undefined) => {
  if (!xs) return null;
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i][1] !== null) return xs[i][1];
  return null;
};
const faN = (x: number, d = 0) => x.toLocaleString('fa-IR', { maximumFractionDigits: d });

/** The last values in plain words — what each line says now, without calling it a buy or a sell. */
export function readings(points: [number, number][], lines: IndicatorLines): string[] {
  const out: string[] = [];
  const price = points[points.length - 1]?.[1];
  if (!price) return out;
  const pos = (v: number) => {
    const pct = (price / v - 1) * 100;
    return `${faN(Math.abs(pct), 1)}٪ ${pct >= 0 ? 'بالای' : 'زیر'}`;
  };
  for (const o of lines.overlays) {
    if (o.key.startsWith('bb')) continue;
    const v = last(o.points);
    if (v !== null) out.push(`قیمت ${pos(v)} ${o.label} است.`);
  }
  const up = last(lines.overlays.find((o) => o.key === 'bb-up')?.points);
  const lo = last(lines.overlays.find((o) => o.key === 'bb-low')?.points);
  if (up !== null && lo !== null && up > lo) {
    const b = (price - lo) / (up - lo);
    out.push(
      b > 1
        ? 'قیمت بالای باند بالای بولینگر است — حرکت از نوسان معمول ۲۰ روز اخیر تندتر بوده.'
        : b < 0
          ? 'قیمت زیر باند پایین بولینگر است — افت از نوسان معمول ۲۰ روز اخیر تندتر بوده.'
          : `قیمت در ${faN(b * 100)}٪ پهنای باند بولینگر است (صفر = باند پایین، ۱۰۰ = باند بالا)؛ پهنای باند ${faN(((up - lo) / price) * 100, 1)}٪ قیمت.`,
    );
  }
  const r = last(lines.rsi ?? undefined);
  if (r !== null) out.push(`RSI ۱۴ برابر ${faN(r)} است${r >= 70 ? ' (بالای ۷۰، «اشباع خرید» در اصطلاح)' : r <= 30 ? ' (زیر ۳۰، «اشباع فروش» در اصطلاح)' : ''}.`);
  if (lines.macd) {
    const m = last(lines.macd.macd);
    const s = last(lines.macd.signal);
    // a gap of a ten-thousandth of the price is a tie, not a crossing
    const side = m !== null && s !== null ? (Math.abs(m - s) <= price * 1e-4 ? 'تقریباً روی' : m > s ? 'بالای' : 'زیر') : null;
    if (m !== null && side) out.push(`MACD ${side} خط سیگنال و ${m >= 0 ? 'مثبت' : 'منفی'} است (میانگین ۱۲ روزه ${m >= 0 ? 'بالای' : 'زیر'} میانگین ۲۶ روزه).`);
  }
  return out;
}

/** What this project measured about such signals on real prices (CLAUDE.md rules 22, 25, 26, 28). */
export function indicatorEvidence(group: 'rial' | 'crypto' | 'other'): string {
  if (group === 'rial')
    return 'سنجیده روی داده واقعی بازار ایران (۱۳۹۰ تا ۱۴۰۵): هیچ قاعده خرید و فروش با میانگین ۵۰، ۱۰۰ یا ۲۰۰ روزه در هیچ دوره‌ای از نگه‌داشتن ساده بهتر نبود؛ RSI بالا بازده بعدی را بیشتر پیش‌بینی می‌کرد نه کمتر (برخلاف تعبیر «اشباع خرید»)؛ و قدرت پیش‌بینی روند بعد از ۱۴۰۰ تقریباً صفر شد. این خطوط وضعیت گذشته را نشان می‌دهند، نه سیگنال خرید یا فروش.';
  if (group === 'crypto')
    return 'سنجیده روی داده واقعی کریپتو: نوسان‌گیری ساعتی با اندیکاتورها حتی بدون کارمزد زیان داد؛ تنها سبک مثبت «روندسوار» بود (نگه‌داری وقتی قیمت بالای میانگین ۵۰ روزه خودش و بیت‌کوین است): حدود ‎+۱۱٪ در هر ۹۰ روز صعودی، ‎−۲٪ در نزولی، با افت سرمایه تا ‎−۱۹٪. این خطوط وضعیت گذشته را نشان می‌دهند، نه سیگنال خرید یا فروش.';
  return 'این خطوط وضعیت گذشته قیمت را خلاصه می‌کنند؛ برای این دارایی آزمونی روی داده واقعی انجام نشده و سیگنال خرید یا فروش نیستند.';
}
