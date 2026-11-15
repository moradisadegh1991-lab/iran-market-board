'use client';
import { useEffect, useState } from 'react';
import { IND_COLOR, INDICATORS, type IndicatorKey } from '@/lib/indicators';
import { INDICATOR_PRESETS_KEY, parsePresets, type IndicatorPreset } from '@/lib/indicator-presets';

export default function IndicatorChips({ value, onChange }: { value: IndicatorKey[]; onChange: (v: IndicatorKey[]) => void }) {
  const [name, setName] = useState('');
  const [presets, setPresets] = useState<IndicatorPreset[]>([]);
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => {
      try { setPresets(parsePresets(localStorage.getItem(INDICATOR_PRESETS_KEY))); setReady(true); }
      catch { setReady(false); setMsg('تنظیمات ذخیره‌شده خوانده نشد؛ برای جلوگیری از حذف داده، ذخیره غیرفعال است.'); }
    };
    read();
    const changed = (e: StorageEvent) => { if (e.key === INDICATOR_PRESETS_KEY) read(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const save = (next: IndicatorPreset[]) => {
    try { localStorage.setItem(INDICATOR_PRESETS_KEY, JSON.stringify(next)); setPresets(next); setMsg('ذخیره شد.'); return true; }
    catch { setMsg('ذخیره در دستگاه ناموفق بود؛ فضای مرورگر را بررسی کنید.'); return false; }
  };
  return <div className="indicator-workspace">
    <div className="chips ind-chips" role="group" aria-label="انتخاب اندیکاتور">
      <span className="ind-chips-label">اندیکاتورها:</span>
      {INDICATORS.map((o) => <button type="button" key={o.key} aria-pressed={value.includes(o.key)} onClick={() => onChange(value.includes(o.key) ? value.filter((k) => k !== o.key) : [...value, o.key])}><i className="ind-sw" style={{ background: IND_COLOR[o.key] }} aria-hidden="true" />{o.label}</button>)}
      {value.length ? <button type="button" onClick={() => onChange([])}>پاک کردن انتخاب</button> : null}
    </div>
    <details className="ind-presets"><summary>چیدمان‌های ذخیره‌شده {presets.length ? `(${presets.length.toLocaleString('fa-IR')})` : ''}</summary>
      <p className="muted small">ترکیب اندیکاتورها روی همین دستگاه ذخیره می‌شود و با پاک‌کردن دادهٔ برنامه از بین می‌رود؛ در فایل پشتیبان دفتر مالی نیست.</p>
      <form onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n || !value.length || !ready) return; if (presets.some((p) => p.name === n)) { setMsg('این نام قبلاً ذخیره شده؛ نام دیگری انتخاب کنید.'); return; } if (presets.length >= 20) { setMsg('حداکثر ۲۰ چیدمان قابل ذخیره است.'); return; } if (save([...presets, { name: n, indicators: value }])) setName(''); }}>
        <label>نام چیدمان <input className="fin-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً روند و مومنتوم" /></label>
        <button className="fin-mini" type="submit" disabled={!ready || !name.trim() || !value.length}>ذخیره انتخاب فعلی</button>
      </form>
      {presets.length ? <ul>{presets.map((p) => <li key={p.name}><button className="fin-mini" type="button" onClick={() => { onChange(p.indicators); setMsg(`چیدمان «${p.name}» اعمال شد.`); }}>{p.name}</button><span className="muted small">{p.indicators.map((k) => INDICATORS.find((i) => i.key === k)?.label).join('، ')}</span><button type="button" className="fin-mini ghost" aria-label={`حذف چیدمان ${p.name}`} onClick={() => { if (confirm(`چیدمان «${p.name}» حذف شود؟`)) save(presets.filter((x) => x.name !== p.name)); }}>حذف</button></li>)}</ul> : <p className="muted small">هنوز چیدمانی ذخیره نشده است.</p>}
      {msg ? <p role="status" className="small">{msg}</p> : null}
    </details>
  </div>;
}
