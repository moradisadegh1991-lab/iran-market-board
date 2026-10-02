// What the charts page's forecast section offers — constants and types only, so the page bundle
// does not pull in the scenario engine (lib/engine/forecast.ts has the maths).
import type { HorizonKey, RiskAssetKey, ScenarioGroup } from './types';

/** The horizons the charts page offers. */
export const FORECAST_HORIZONS: {
  key: HorizonKey;
  label: string;
  days: number;
}[] = [
  { key: 'w1', label: 'هفتگی', days: 7 },
  { key: 'm1', label: 'ماهانه', days: 30 },
  { key: 'm3', label: '۳ ماهه', days: 90 },
  { key: 'y1', label: 'یک ساله', days: 365 },
];

/** Assets with a long enough daily history (lib/series.ts) to forecast. */
export const FORECAST_ASSETS: {
  key: RiskAssetKey;
  label: string;
  unit: 'toman' | 'usd' | 'point';
  group: ScenarioGroup;
}[] = [
  { key: 'usd', label: 'دلار آزاد', unit: 'toman', group: 'fx' },
  { key: 'usdt', label: 'تتر', unit: 'toman', group: 'fx' },
  { key: 'g18', label: 'طلای ۱۸ عیار', unit: 'toman', group: 'gold' },
  { key: 'coin', label: 'سکه امامی', unit: 'toman', group: 'gold' },
  { key: 'nim', label: 'نیم سکه', unit: 'toman', group: 'gold' },
  { key: 'rob', label: 'ربع سکه', unit: 'toman', group: 'gold' },
  { key: 'silver', label: 'نقره ۹۹۹', unit: 'toman', group: 'gold' },
  { key: 'ons', label: 'انس جهانی طلا', unit: 'usd', group: 'gold' },
  { key: 'tse', label: 'شاخص کل بورس', unit: 'point', group: 'tse' },
  { key: 'btc', label: 'بیت‌کوین', unit: 'usd', group: 'crypto' },
  { key: 'eth', label: 'اتریوم', unit: 'usd', group: 'crypto' },
];

export interface Calibration {
  /** past forecasts checked */
  n: number;
  /** share of them where the price ended inside the 90% band — ~90 is honest */
  insidePct: number;
  /** ended above the band / below it */
  abovePct: number;
  belowPct: number;
  /** ended above the median forecast — ~50 means the median was not biased */
  aboveMedianPct: number;
  /** typical miss of the median, in percent */
  medianErrPct: number;
  /** non-overlapping horizon-long windows the checked forecasts span — the real sample size */
  periods: number;
  from: string;
  to: string;
}
