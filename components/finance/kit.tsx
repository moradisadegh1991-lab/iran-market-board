'use client';
import { useEffect, useMemo, useState } from 'react';
import { JALALI_MONTHS, isoToJalali, jalaliMonthLength, jalaliToIso } from '@/lib/jalali';
import { isNum } from '@/lib/num';
import { Glyph } from '../icons';

// ── formatting ─────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const faPlain = (n: number) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);

// LRM keeps a sign glued to the left of its digits inside RTL text, as fmtPct does
const NEG = '\u200E−';
const POS = '\u200E+';

/** Full toman figure, e.g. «۱۲٬۵۰۰٬۰۰۰ تومان». Input is RIAL. */
export function fmtToman(rial: number | null | undefined): string {
  if (!isNum(rial)) return '—';
  const t = Math.round(rial / 10);
  return `${t < 0 ? NEG : ''}${nf.format(Math.abs(t))} تومان`;
}

/** Short form for tiles, e.g. «۱۲٫۵ میلیون تومان». Input is RIAL. */
export function fmtTomanShort(rial: number | null | undefined): string {
  if (!isNum(rial)) return '—';
  const t = rial / 10;
  const a = Math.abs(t);
  const s = t < 0 ? NEG : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} میلیارد تومان`;
  if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون تومان`;
  if (a >= 1e4) return `${s}${(a / 1e3).toLocaleString('fa-IR', { maximumFractionDigits: 0 })} هزار تومان`;
  return `${s}${nf.format(a)} تومان`;
}

/** Digits and words mixed: must not get the LTR `.num` treatment (CLAUDE.md rule 16). */
export function Money({ rial, short, signed, className }: { rial: number | null | undefined; short?: boolean; signed?: boolean; className?: string }) {
  const tone = signed && isNum(rial) && rial !== 0 ? (rial > 0 ? ' up' : ' down') : '';
  const text = short ? fmtTomanShort(rial) : fmtToman(rial);
  return <bdi className={`fin-money${tone}${className ? ` ${className}` : ''}`}>{signed && isNum(rial) && rial > 0 ? `${POS}${text}` : text}</bdi>;
}

export const fmtDateFa = (iso: string) => {
  try {
    const j = isoToJalali(iso);
    return `${faPlain(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faPlain(j.jy)}`;
  } catch {
    return iso;
  }
};

export const fmtPctFa = (p: number | null | undefined, digits = 0) => (isNum(p) ? `${p.toLocaleString('fa-IR', { maximumFractionDigits: digits })}٪` : '—');

// ── input parsing ──────────────────────────────────────────────────────────

/** Accepts Persian/Arabic/Latin digits and any separators people type: «۱۲٬۵۰۰٬۰۰۰», "12,500,000". */
export function parseAmount(s: string): number {
  const latin = s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[^\d.]/g, '');
  const n = Number(latin);
  return latin && Number.isFinite(n) ? n : NaN;
}

// ── form controls ──────────────────────────────────────────────────────────

/** The hint sits outside the <label> so it does not become part of the control's accessible name. */
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="fin-field">
      <label>
        <span className="fin-label">{label}</span>
        {children}
      </label>
      {hint ? <span className="fin-hint">{hint}</span> : null}
    </div>
  );
}

/** Toman text box that shows what was typed in words, so a missing zero is caught before saving. */
export function TomanInput({ value, onChange, placeholder, label = 'مبلغ (تومان)' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const n = parseAmount(value);
  return (
    <Field label={label} hint={isNum(n) && n > 0 ? fmtTomanShort(n * 10) : value ? 'عدد نامعتبر' : ' '}>
      <input inputMode="numeric" dir="ltr" className="fin-input" value={value} placeholder={placeholder ?? 'مثلاً ۲۵۰۰۰۰۰'} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextInput({ label, value, onChange, placeholder, list }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string }) {
  return (
    <Field label={label}>
      <input className="fin-input" value={value} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumInput({ label, value, onChange, step, hint }: { label: string; value: string; onChange: (v: string) => void; step?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input inputMode="decimal" dir="ltr" className="fin-input" value={value} step={step} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectBox<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <Field label={label}>
      <select className="fin-input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Jalali date as three selects; value/onChange are Gregorian ISO, which is what gets stored. */
export function JalaliDate({ label, value, onChange, yearsBack = 5, yearsAhead = 10 }: { label: string; value: string; onChange: (iso: string) => void; yearsBack?: number; yearsAhead?: number }) {
  const j = useMemo(() => isoToJalali(value), [value]);
  const nowY = useMemo(() => isoToJalali(new Date().toISOString().slice(0, 10)).jy, []);
  const years = Array.from({ length: yearsBack + yearsAhead + 1 }, (_, i) => nowY - yearsBack + i);
  const set = (jy: number, jm: number, jd: number) => onChange(jalaliToIso(jy, jm, Math.min(jd, jalaliMonthLength(jy, jm))));
  const days = jalaliMonthLength(j.jy, j.jm);
  return (
    <Field label={label}>
      <span className="fin-date">
        <select className="fin-input" aria-label="روز" value={j.jd} onChange={(e) => set(j.jy, j.jm, +e.target.value)}>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {faPlain(d)}
            </option>
          ))}
        </select>
        <select className="fin-input" aria-label="ماه" value={j.jm} onChange={(e) => set(j.jy, +e.target.value, j.jd)}>
          {JALALI_MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select className="fin-input" aria-label="سال" value={j.jy} onChange={(e) => set(+e.target.value, j.jm, j.jd)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {faPlain(y)}
            </option>
          ))}
        </select>
      </span>
    </Field>
  );
}

// ── layout bits ────────────────────────────────────────────────────────────

export function Card({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel pad fin-card${className ? ` ${className}` : ''}`}>
      {title || action ? (
        <div className="fin-card-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Bar({ pct, tone, marker }: { pct: number; tone?: 'ok' | 'warn' | 'bad'; marker?: number }) {
  return (
    <span className={`fin-bar ${tone ?? 'ok'}`} role="img" aria-label={fmtPctFa(pct)}>
      <b style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      {isNum(marker) ? <i style={{ insetInlineStart: `${Math.max(0, Math.min(100, marker))}%` }} /> : null}
    </span>
  );
}

export function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="fin-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {sub ? <dd className="fin-stat-sub">{sub}</dd> : null}
    </div>
  );
}

/** Small open/close wrapper for "add" forms so lists stay the first thing on the page. */
export function Disclosure({ label, children, defaultOpen = false }: { label: string; children: (close: () => void) => React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fin-disclosure">
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'بستن' : label}
      </button>
      {open ? <div className="fin-form">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

/**
 * Tabs for a page that holds several lists: a scrolling pill strip, one panel shown. `badge` is a count that wants attention
 * (cards found in SMS and not yet linked). Arrow keys move between tabs (the app is right-to-left, so ← is the next one).
 */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix = 'tab' }: { label: string; tabs: { key: T; label: string; title?: string; badge?: number }[]; value: T; onChange: (k: T) => void; idPrefix?: string }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabs[(i + d + tabs.length) % tabs.length];
    onChange(next.key);
    // every tab is already in the page (tabIndex -1 is still focusable), so no need to wait for the re-render
    document.getElementById(`${idPrefix}-${next.key}`)?.focus();
  };
  return (
    <div className="fin-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          id={`${idPrefix}-${t.key}`}
          role="tab"
          type="button"
          title={t.title}
          aria-selected={value === t.key}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
          {t.badge ? <span className="fin-tab-badge" aria-label={`${t.badge.toLocaleString('fa-IR')} مورد`}>{t.badge.toLocaleString('fa-IR')}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function confirmDelete(what: string): boolean {
  return typeof window !== 'undefined' && window.confirm(`${what} حذف شود؟ این کار برگشت‌پذیر نیست.`);
}

/** a sheet over the page (the «بیشتر» sheet is hidden on wide screens, this one is not) */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, [onClose]);
  return (
    <div className="fin-modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fin-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <b>{title}</b>
          <button className="sheet-close" onClick={onClose} aria-label="بستن">
            <Glyph.Close size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
