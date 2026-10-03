'use client';
import { IND_COLOR, INDICATORS, type IndicatorKey } from '@/lib/indicators';

/** The indicator toggles of the charts page — the price chart and the forecast share them. */
export default function IndicatorChips({ value, onChange }: { value: IndicatorKey[]; onChange: (v: IndicatorKey[]) => void }) {
  return (
    <div className="chips ind-chips" role="group" aria-label="اندیکاتور">
      <span className="ind-chips-label">اندیکاتور:</span>
      {INDICATORS.map((o) => (
        <button key={o.key} aria-pressed={value.includes(o.key)} onClick={() => onChange(value.includes(o.key) ? value.filter((k) => k !== o.key) : [...value, o.key])}>
          <i className="ind-sw" style={{ background: IND_COLOR[o.key] }} aria-hidden="true" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
