import { INDICATORS, type IndicatorKey } from './indicators';
export const INDICATOR_PRESETS_KEY = 'imf.indicator.presets.v1';
export const INDICATOR_LAST_KEY = 'imf.indicator.last.v1';
export interface IndicatorPreset { name: string; indicators: IndicatorKey[] }
export function validIndicators(value: unknown): IndicatorKey[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(INDICATORS.map((x) => x.key));
  return [...new Set(value.filter((x): x is IndicatorKey => typeof x === 'string' && known.has(x as IndicatorKey)))];
}
export function parsePresets(raw: string | null): IndicatorPreset[] {
  if (raw === null) return [];
  const v: unknown = JSON.parse(raw);
  if (!Array.isArray(v)) throw new Error('invalid presets');
  return v.slice(0, 20).flatMap((x: unknown) => {
    if (!x || typeof x !== 'object') return [];
    const p = x as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || !Array.isArray(p.indicators)) return [];
    const indicators = validIndicators(p.indicators);
    if (!indicators.length) return [];
    return [{ name: p.name.trim(), indicators }];
  });
}
