// Chart series for the /charts page: intraday for 1-day / 1-week, daily history for longer ranges.
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgRange } from '@/lib/sources/coingecko';
import { intradayPairs, loadIntraday } from '@/lib/intraday';
import { buildSeries, coinSeries, loadSeriesInputs } from '@/lib/series';
import { isNum, rialToToman } from '@/lib/num';
import type { AssetKey } from '@/lib/types';

export type Timeframe = '1d' | '1w' | '1m' | '3m' | '6m' | '1y';
export const TIMEFRAMES: { key: Timeframe; label: string; days: number }[] = [
  { key: '1d', label: 'روزانه', days: 1 },
  { key: '1w', label: 'هفتگی', days: 7 },
  { key: '1m', label: 'ماهانه', days: 30 },
  { key: '3m', label: '۳ ماه', days: 90 },
  { key: '6m', label: '۶ ماه', days: 180 },
  { key: '1y', label: '۱ سال', days: 365 },
];

export const CHART_ASSETS: { key: AssetKey; label: string; unit: 'toman' | 'usd' | 'point'; cg?: string }[] = [
  { key: 'usd', label: 'دلار آزاد', unit: 'toman' },
  { key: 'usdt', label: 'تتر', unit: 'toman' },
  { key: 'g18', label: 'طلای ۱۸', unit: 'toman' },
  { key: 'coin', label: 'سکه امامی', unit: 'toman' },
  { key: 'ons', label: 'انس جهانی', unit: 'usd', cg: 'pax-gold' },
  { key: 'btc', label: 'بیت‌کوین', unit: 'usd', cg: 'bitcoin' },
  { key: 'eth', label: 'اتریوم', unit: 'usd', cg: 'ethereum' },
  { key: 'tse', label: 'شاخص کل بورس', unit: 'point' },
];

export interface ChartData {
  asset: string;
  label: string;
  unit: 'toman' | 'usd' | 'point';
  tf: Timeframe;
  resolution: 'intraday' | 'daily';
  points: [number, number][]; // [ms, value in display unit]
  stats: { first: number; last: number; changePct: number; high: number; low: number } | null;
  note?: string;
}

const toDisplay = (unit: string, v: number) => (unit === 'toman' ? rialToToman(v) : v);
const dateMs = (d: string) => Date.parse(`${d}T12:00:00Z`);

function withStats(base: Omit<ChartData, 'stats'>): ChartData {
  const vals = base.points.map((p) => p[1]).filter(isNum);
  if (vals.length < 2) return { ...base, stats: null };
  const first = vals[0], last = vals[vals.length - 1];
  return { ...base, stats: { first, last, changePct: (last / first - 1) * 100, high: Math.max(...vals), low: Math.min(...vals) } };
}

export async function getChart(assetParam: string, tf: Timeframe): Promise<ChartData> {
  const days = TIMEFRAMES.find((t) => t.key === tf)!.days;
  const since = Date.now() - days * 86400_000;

  // altcoin by CoinGecko id: "cg:<id>"
  if (assetParam.startsWith('cg:')) {
    const id = assetParam.slice(3).replace(/[^a-z0-9-]/gi, '');
    if (days <= 7) {
      const r = await cachedSource<[number, number][]>(`cgRange_${id}_${days}`, days === 1 ? 300 : 900, () => fetchCgRange(id, days as 1 | 7), 3600 * 6);
      return withStats({ asset: assetParam, label: id, unit: 'usd', tf, resolution: 'intraday', points: (r.data ?? []).filter(([t]) => t >= since) });
    }
    const s = await coinSeries(id);
    return withStats({ asset: assetParam, label: id, unit: 'usd', tf, resolution: 'daily', points: s.dates.map((d, i) => [dateMs(d), s.prices[i]] as [number, number]).filter(([t]) => t >= since) });
  }

  const meta = CHART_ASSETS.find((a) => a.key === assetParam);
  if (!meta) throw new Error('unknown asset');

  if (days <= 7) {
    if (meta.cg) {
      const r = await cachedSource<[number, number][]>(`cgRange_${meta.cg}_${days}`, days === 1 ? 300 : 900, () => fetchCgRange(meta.cg!, days as 1 | 7), 3600 * 6);
      const pts = (r.data ?? []).filter(([t]) => t >= since);
      if (pts.length >= 4)
        return withStats({ asset: meta.key, label: meta.label, unit: meta.unit, tf, resolution: 'intraday', points: pts, note: meta.key === 'ons' ? 'نمودار درون‌روزی انس از قیمت PAXG (توکن پشتوانه‌دار یک انس طلا) ساخته شده است.' : undefined });
    } else {
      const store = await loadIntraday();
      const pts = intradayPairs(store, meta.key, since).map(([t, v]) => [t, toDisplay(meta.unit, v)] as [number, number]);
      if (pts.length >= 6) return withStats({ asset: meta.key, label: meta.label, unit: meta.unit, tf, resolution: 'intraday', points: pts });
    }
  }

  const inputs = await loadSeriesInputs();
  const s = buildSeries(inputs, meta.key);
  const minDays = days <= 7 ? 14 : days;
  const cut = Date.now() - minDays * 86400_000;
  const points = s.dates.map((d, i) => [dateMs(d), toDisplay(meta.unit, s.prices[i])] as [number, number]).filter(([t]) => t >= cut);
  const note =
    days <= 7
      ? 'داده درون‌روزی این دارایی هنوز کافی نیست (هر ۱۰ دقیقه یک نقطه ثبت می‌شود)؛ تا آن زمان قیمت‌های پایانی روزانه دو هفته اخیر نمایش داده می‌شود.'
      : s.reconstructed
        ? `بخشی از این نمودار از داده جایگزین (${s.basis}) بازسازی شده و ممکن است با قیمت واقعی آن روزها کمی فاصله داشته باشد.`
        : undefined;
  return withStats({ asset: meta.key, label: meta.label, unit: meta.unit, tf, resolution: 'daily', points, note });
}
