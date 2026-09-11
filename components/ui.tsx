'use client';
import { fmtPct, isNum } from '@/lib/num';

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children ? <p className="lede">{children}</p> : null}
    </div>
  );
}

export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          {isNum(o.count) ? <span className="count">{o.count.toLocaleString('fa-IR')}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function MultiChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  const toggle = (k: T) => {
    const next = value.includes(k) ? value.filter((x) => x !== k) : [...value, k];
    onChange(next.length ? next : [k]);
  };
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} aria-pressed={value.includes(o.key)} onClick={() => toggle(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      {children}
    </label>
  );
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const dir = (p: number | null | undefined) => (!isNum(p) || Math.abs(p) < 1e-9 ? 'flat' : p > 0 ? 'up' : 'down');

export function Pct({ v, digits = 1 }: { v: number | null | undefined; digits?: number }) {
  return <span className={`pct num ${dir(v)}`}>{fmtPct(v, digits)}</span>;
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="filterbar">{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
