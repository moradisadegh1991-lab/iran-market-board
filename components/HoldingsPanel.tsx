'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { fmtInt, fmtNum, fmtPct, isNum, tehranDate } from '@/lib/num';
import { JALALI_MONTHS, gregorianToJalali, jalaliMonthLength, jalaliToIso } from '@/lib/jalali';
import type { HoldingKind, HoldingsSummary, Instrument } from '@/lib/holdings';
import type { HoldingsAnalysis } from '@/lib/engine/holdings-analysis';
import type { HorizonKey, PortfolioHorizon, Profile } from '@/lib/types';
import { Chips, Empty, Pct, Select } from './ui';
import { tomanWords } from './TradeEntry';

type State = HoldingsSummary & {
  instruments: Instrument[];
  kindLabel: Record<HoldingKind, string>;
  kindQtyLabel: Record<HoldingKind, string>;
  analysis?: HoldingsAnalysis;
  horizonLabel?: Record<HorizonKey, string>;
  profile?: Profile;
  horizon?: PortfolioHorizon;
  error?: string;
};

const GRADE_LABEL: Record<string, string> = { good: 'ورود مناسب', fair: 'ورود متوسط', poor: 'ورود در نقطه گران', unknown: 'قابل داوری نیست' };
const GRADE_PILL: Record<string, string> = { good: 'ok', fair: 'warn', poor: 'bad', unknown: '' };
const PROFILE_LABEL: Record<Profile, string> = { conservative: 'محتاط', balanced: 'متعادل', aggressive: 'جسور' };
const PF_HORIZONS: PortfolioHorizon[] = ['m1', 'm3', 'm6', 'y1'];
const PF_HORIZON_LABEL: Record<PortfolioHorizon, string> = { m1: '۱ ماهه', m3: '۳ ماهه', m6: '۶ ماهه', y1: 'سالانه' };

const KIND_CLASS: Record<HoldingKind, string> = { gold: 'c-gold', coin: 'c-cash', currency: 'c-usd', crypto: 'c-btc' };
const TODAY_J = gregorianToJalali(
  Number(tehranDate().slice(0, 4)),
  Number(tehranDate().slice(5, 7)),
  Number(tehranDate().slice(8, 10)),
);
const J_YEARS = Array.from({ length: 12 }, (_, i) => TODAY_J.jy - i); // this year back ~12 years

const faNum = (n: number) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);

const faDate = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

export default function HoldingsPanel() {
  const [state, setState] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<HoldingKind>('gold');
  const [instrument, setInstrument] = useState('g18');
  const [qty, setQty] = useState('');
  const [paid, setPaid] = useState('');
  const [jy, setJy] = useState('');
  const [jm, setJm] = useState('');
  const [jd, setJd] = useState('');

  // the API stores Gregorian; '' means "not specified", which stays allowed
  let boughtOn = '';
  let dateErr: string | null = null;
  if (jy && jm && jd) {
    try {
      boughtOn = jalaliToIso(Number(jy), Number(jm), Number(jd));
      if (boughtOn > tehranDate()) dateErr = 'تاریخ خرید نمی‌تواند در آینده باشد.';
    } catch (e) {
      dateErr = e instanceof Error ? e.message : 'تاریخ شمسی نامعتبر است.';
    }
  } else if (jy || jm || jd) {
    dateErr = 'سال، ماه و روز را کامل کنید یا هر سه را خالی بگذارید.';
  }
  const maxDay = jy && jm ? jalaliMonthLength(Number(jy), Number(jm)) : 31;
  const [note, setNote] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [pfProfile, setPfProfile] = useState<Profile>('balanced');
  const [pfHorizon, setPfHorizon] = useState<PortfolioHorizon>('m3');
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/holdings?profile=${pfProfile}&horizon=${pfHorizon}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: State) => {
        if (j.error) throw new Error(j.error);
        setState(j);
        setLoadErr(null);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [pfProfile, pfHorizon]);

  useEffect(load, [load]);

  const ofKind = useMemo(() => (state?.instruments ?? []).filter((i) => i.kind === kind), [state, kind]);
  useEffect(() => {
    if (ofKind.length && !ofKind.some((i) => i.key === instrument)) setInstrument(ofKind[0].key);
  }, [ofKind, instrument]);

  const inst = state?.instruments.find((i) => i.key === instrument);
  const qtyNum = Number(qty);
  const paidNum = Number(paid);
  const impliedUnit = isNum(qtyNum) && qtyNum > 0 && isNum(paidNum) && paidNum > 0 ? paidNum / qtyNum : null;

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setFormErr(null);
    try {
      const r = await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      setState((prev) => (prev ? { ...prev, ...j } : prev));
      return true;
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (dateErr) return;
    const ok = await post({ action: 'add', instrument, qty: qtyNum, paidToman: paidNum, boughtOn, note });
    if (ok) {
      setQty('');
      setPaid('');
      setNote('');
      setJy('');
      setJm('');
      setJd('');
      setOpen(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!secret) {
      setFormErr('برای حذف، رمز مدیر را در فرم افزودن وارد کنید.');
      setOpen(true);
      return;
    }
    if (!confirm(`«${label}» از فهرست دارایی‌ها حذف شود؟`)) return;
    await post({ action: 'remove', id });
  }

  if (loadErr) return <Empty>دریافت دارایی‌ها ممکن نشد: {loadErr}</Empty>;
  if (!state) return <p className="empty">در حال دریافت دارایی‌ها…</p>;

  const hasItems = state.items.length > 0;

  return (
    <section className="holdings">
      <div className="holdings-head">
        <h2>دارایی واقعی من</h2>
        <button className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'بستن فرم' : 'افزودن دارایی'}
        </button>
      </div>
      <p className="lede">
        مقدار و مبلغی که واقعاً پرداخت کرده‌اید را ثبت کنید؛ ارزش روز و سود و زیان با قیمت‌های زنده همین داشبورد محاسبه می‌شود. این فهرست فقط ثبت و ارزش‌گذاری است و چیزی خرید و
        فروش نمی‌کند.
      </p>

      {hasItems ? (
        <>
          <div className="panel pad holdings-total">
            <dl className="metrics">
              <div>
                <dt>مجموع ارزش روز</dt>
                <dd className="num big">{tomanWords(state.totalValueToman)}</dd>
              </div>
              <div>
                <dt>مجموع پرداختی</dt>
                <dd className="num">{tomanWords(state.totalPaidToman)}</dd>
              </div>
              <div>
                <dt>سود / زیان</dt>
                <dd className={`num ${state.pnlToman >= 0 ? 'up' : 'down'}`}>{tomanWords(state.pnlToman)}</dd>
              </div>
              <div>
                <dt>بازده</dt>
                <dd>
                  <Pct v={state.pnlPct} digits={1} />
                </dd>
              </div>
            </dl>
            {state.byKind.length ? (
              <>
                <div className="alloc" role="img" aria-label={state.byKind.map((k) => `${k.label} ${Math.round(k.share * 100)} درصد`).join('، ')}>
                  {state.byKind.map((k) => (
                    <div key={k.kind} className={KIND_CLASS[k.kind]} style={{ width: `${k.share * 100}%` }}>
                      {k.share >= 0.08 ? fmtPct(k.share * 100, 0, false) : ''}
                    </div>
                  ))}
                </div>
                <div className="legend">
                  {state.byKind.map((k) => (
                    <span key={k.kind}>
                      <i className={KIND_CLASS[k.kind]} /> {k.label} · {tomanWords(k.valueToman)}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
            {state.warnings.length ? (
              <ul className="notes">
                {state.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {state.analysis?.match ? (
            <div className="pf-match panel pad">
              <h3>تطابق با سبد پیشنهادی</h3>
              <div className="pf-match-controls">
                <Chips
                  label="پروفایل"
                  value={pfProfile}
                  onChange={setPfProfile}
                  options={(Object.keys(PROFILE_LABEL) as Profile[]).map((k) => ({ key: k, label: PROFILE_LABEL[k] }))}
                />
                <Chips
                  label="افق"
                  value={pfHorizon}
                  onChange={setPfHorizon}
                  options={PF_HORIZONS.map((h) => ({ key: h, label: PF_HORIZON_LABEL[h] }))}
                />
              </div>
              <div className="pf-score">
                <strong>{fmtInt(Math.round(state.analysis.match.similarityPct))}٪</strong>
                <span className="muted">درصد شباهت ترکیب سبد شما به سبد پیشنهادی</span>
              </div>
              <p className="lede">{state.analysis.match.headline}</p>
              <div className="table-scroll">
                <table className="t">
                  <thead>
                    <tr>
                      <th scope="col">دسته</th>
                      <th scope="col">سبد شما</th>
                      <th scope="col">پیشنهاد</th>
                      <th scope="col">اختلاف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.analysis.match.classes.map((c) => (
                      <tr key={c.cls}>
                        <th scope="row">{c.label}</th>
                        <td>{fmtPct(c.mine * 100, 0, false)}</td>
                        <td className="muted">{fmtPct(c.suggested * 100, 0, false)}</td>
                        <td className={Math.abs(c.gapPct) < 3 ? 'muted' : c.gapPct > 0 ? 'up' : 'down'}>{c.advice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {state.analysis.match.topFix ? <p className="notes-1">{state.analysis.match.topFix}</p> : null}
              <p className="muted small">سهام بورس و صندوق درآمد ثابت در فهرست دارایی‌ها قابل ثبت نیستند، پس اگر آن‌ها را دارید، درصد شباهت واقعی از این عدد بالاتر است.</p>
            </div>
          ) : null}

          <div className="table-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th scope="col">دارایی</th>
                  <th scope="col">مقدار</th>
                  <th scope="col">قیمت روز هر واحد</th>
                  <th scope="col">ارزش روز</th>
                  <th scope="col">پرداختی</th>
                  <th scope="col">سود / زیان</th>
                  <th scope="col">بازده</th>
                  <th scope="col">تاریخ خرید</th>
                  <th scope="col">تحلیل</th>
                  <th scope="col">
                    <span className="sr-only">حذف</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((h) => {
                  const an = state.analysis?.perHolding.find((a) => a.id === h.id);
                  const isOpen = openRow === h.id;
                  return (
                  <Fragment key={h.id}>
                  <tr>
                    <th scope="row" className="sym">
                      <span className={`swatch ${KIND_CLASS[h.kind]}`} aria-hidden="true" />
                      {h.label}
                      {h.note ? <small className="muted"> · {h.note}</small> : null}
                    </th>
                    <td className="num">
                      {fmtNum(h.qty, h.qty < 1 ? 5 : 2)} {h.unit}
                    </td>
                    <td className="num">{isNum(h.unitPriceToman) ? fmtInt(h.unitPriceToman) : <span className="muted">—</span>}</td>
                    <td className="num">{isNum(h.valueToman) ? fmtInt(h.valueToman) : <span className="muted">{h.priceNote ?? '—'}</span>}</td>
                    <td className="num muted">{fmtInt(h.paidToman)}</td>
                    <td className={`num ${isNum(h.pnlToman) ? (h.pnlToman >= 0 ? 'up' : 'down') : ''}`}>{isNum(h.pnlToman) ? fmtInt(h.pnlToman) : '—'}</td>
                    <td>
                      <Pct v={h.pnlPct} digits={1} />
                    </td>
                    <td className="muted">{h.boughtOn ? faDate(h.boughtOn) : '—'}</td>
                    <td>
                      {an ? (
                        <button
                          className="verdict-btn"
                          onClick={() => setOpenRow(isOpen ? null : h.id)}
                          aria-expanded={isOpen}
                          aria-label={`تحلیل ${h.label}`}
                        >
                          <span className={`state-pill ${GRADE_PILL[an.entry.grade]}`}>{GRADE_LABEL[an.entry.grade]}</span>
                          <span aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => remove(h.id, h.label)} disabled={busy} aria-label={`حذف ${h.label}`}>
                        ✕
                      </button>
                    </td>
                  </tr>
                  {isOpen && an ? (
                    <tr className="verdict-row">
                      <td colSpan={10}>
                        <p className="verdict-text">{an.entry.text}</p>
                        {an.horizons ? (
                          <>
                            <h4>ریسک نگهداری و فروش در افق‌های مختلف</h4>
                            <div className="table-scroll">
                              <table className="t compact">
                                <thead>
                                  <tr>
                                    <th scope="col">افق</th>
                                    <th scope="col">ریسک نگهداری</th>
                                    <th scope="col">ریسک فروش</th>
                                    <th scope="col">احتمال افت</th>
                                    <th scope="col">بازده مورد انتظار</th>
                                    <th scope="col">اعتماد</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(Object.keys(state.horizonLabel ?? {}) as HorizonKey[]).map((k) => {
                                    const hz = an.horizons?.[k];
                                    return (
                                      <tr key={k}>
                                        <th scope="row">{state.horizonLabel?.[k]}</th>
                                        {hz ? (
                                          <>
                                            <td className="num">{fmtInt(hz.hold)}</td>
                                            <td className="num">{fmtInt(hz.sell)}</td>
                                            <td className="num">{fmtPct(hz.pDown * 100, 0, false)}</td>
                                            <td><Pct v={hz.expReturnPct} digits={1} /></td>
                                            <td className="num muted">{fmtPct(hz.confidence * 100, 0, false)}</td>
                                          </>
                                        ) : (
                                          <td colSpan={5} className="muted">داده کافی نیست</td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ) : null}
                        {an.note ? <p className="muted small">{an.note}</p> : null}
                        <p className="muted small">عدد صفر کم‌ریسک و صد پرریسک است. این اعداد توصیه خرید یا فروش نیستند.</p>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty>هنوز دارایی‌ای ثبت نشده. با دکمه «افزودن دارایی» اولین قلم را وارد کنید.</Empty>
      )}

      {open ? (
        <div className="panel pad holdings-form">
          <h3>افزودن دارایی</h3>
          <div className="ticket-grid">
            <div>
              <span className="field-label">نوع سرمایه</span>
              <Chips label="نوع سرمایه" value={kind} onChange={setKind} options={(Object.keys(state.kindLabel) as HoldingKind[]).map((k) => ({ key: k, label: state.kindLabel[k] }))} />
            </div>
            <div>
              <span className="field-label">{state.kindLabel[kind]}</span>
              <Select label={state.kindLabel[kind]} value={instrument} onChange={setInstrument} options={ofKind.map((i) => ({ key: i.key, label: i.label }))} />
            </div>
            <label className="field cap-field">
              <span className="field-label">{state.kindQtyLabel[kind]}</span>
              <input inputMode="decimal" placeholder="مقدار" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} />
              {inst ? <small className="muted">واحد: {inst.unit}</small> : null}
            </label>
            <label className="field cap-field">
              <span className="field-label">مبلغ کل خرید شده (تومان)</span>
              <input inputMode="numeric" placeholder="مبلغ را وارد کنید" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d]/g, ''))} />
              <small className="muted">{isNum(paidNum) && paidNum > 0 ? tomanWords(paidNum) : 'مبلغی که واقعاً پرداخت کردید'}</small>
            </label>
            <div className="field cap-field">
              <span className="field-label">تاریخ خرید (اختیاری)</span>
              <div className="jdate">
                <select aria-label="سال" value={jy} onChange={(e) => setJy(e.target.value)}>
                  <option value="">سال</option>
                  {J_YEARS.map((y) => (
                    <option key={y} value={y}>{faNum(y)}</option>
                  ))}
                </select>
                <select aria-label="ماه" value={jm} onChange={(e) => setJm(e.target.value)}>
                  <option value="">ماه</option>
                  {JALALI_MONTHS.map((label, i) => (
                    <option key={label} value={i + 1}>{label}</option>
                  ))}
                </select>
                <select aria-label="روز" value={jd} onChange={(e) => setJd(e.target.value)}>
                  <option value="">روز</option>
                  {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{faNum(d)}</option>
                  ))}
                </select>
              </div>
              <small className={dateErr ? 'err-text' : 'muted'}>
                {dateErr ?? (boughtOn ? `معادل میلادی: ${boughtOn}` : 'هجری شمسی؛ برای تحلیل زمان خرید')}
              </small>
            </div>
            <label className="field cap-field">
              <span className="field-label">توضیحات (اختیاری)</span>
              <input placeholder="توضیحات" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
              {impliedUnit ? <small className="muted">میانگین خرید شما: {fmtInt(impliedUnit)} تومان برای هر {inst?.unit}</small> : null}
            </label>
          </div>
          <div className="admin">
            <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <button className="btn run" disabled={busy || !secret || !qty || !paid} onClick={add}>
              {busy ? 'در حال ثبت…' : 'افزودن'}
            </button>
          </div>
          {formErr ? <Empty>{formErr}</Empty> : null}
        </div>
      ) : null}
    </section>
  );
}
