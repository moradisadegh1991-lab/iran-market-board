'use client';
import { useMemo, useState } from 'react';
import { addDays } from '@/lib/finance/calc';
import { newId, rialToTomanN, tomanToRial } from '@/lib/finance/model';
import { BOOKING_STATUS_LABEL, typeInfo, type Booking, type BookingStatus, type Business, type PayMethod } from '@/lib/biz/model';
import { addBooking, assignSeat, calendarOf, rescheduleBooking, setBookingStatus } from '@/lib/biz/ops';
import { availableSlots, tehranParts, weekdayOf } from '@/lib/biz/slots';
import { templatesFor } from '@/lib/biz/templates';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtDateFa, JalaliDate, Money, NumInput, parseAmount, TextInput, TomanInput } from '../finance/kit';
import { Chips } from '../ui';
import { fa, faTime, PayPicker, smsHref, WEEK_ORDER, WEEKDAYS_FA, WithBiz } from './kit';

const seatWord = (b: Business) => (b.type === 'barber' || b.type === 'salon' ? 'صندلی' : b.type === 'gym' ? 'سالن' : b.type === 'carwash' || b.type === 'repair' ? 'جایگاه' : 'میز');

/** Saturday of the week a day is in */
const saturdayOf = (day: string) => addDays(day, -((weekdayOf(day) + 1) % 7));

function SlotPicker({ b, serviceIds, value, onChange, excludeId, seatId }: { b: Business; serviceIds: string[]; value: number | null; onChange: (t: number) => void; excludeId?: string; seatId?: string | null }) {
  const { today } = useFinance();
  const [day, setDay] = useState(today);
  const dur = serviceIds.reduce((s, id) => s + (b.services.find((x) => x.id === id)?.durationMin ?? 0), 0);
  const slots = dur ? availableSlots(calendarOf(b, excludeId), day, dur, Date.now(), seatId) : [];
  return (
    <div className="fin-span">
      <JalaliDate label="روز" value={day} onChange={setDay} yearsBack={0} yearsAhead={1} />
      {!dur ? (
        <p className="small muted">اول خدمت را انتخاب کنید.</p>
      ) : slots.length ? (
        <div className="chips biz-slots" role="radiogroup" aria-label="ساعت">
          {slots.map((t) => (
            <button key={t} role="radio" aria-checked={value === t} onClick={() => onChange(t)}>
              {faTime(t)}
            </button>
          ))}
        </div>
      ) : (
        <p className="small muted">این روز ({WEEKDAYS_FA[weekdayOf(day)]}) زمان خالی ندارد یا تعطیل است.</p>
      )}
    </div>
  );
}

function NewBooking({ b, onDone }: { b: Business; onDone: () => void }) {
  const { update } = useFinance();
  const [svc, setSvc] = useState<string[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [seat, setSeat] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const active = b.services.filter((s) => s.active);
  return (
    <div className="fin-grid">
      <div className="fin-span">
        <span className="fin-label">خدمت‌ها (چندتایی)</span>
        <div className="chips" role="group" aria-label="خدمت‌ها">
          {active.map((s) => (
            <button
              key={s.id}
              aria-pressed={svc.includes(s.id)}
              onClick={() => {
                setSvc((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]));
                setAt(null);
              }}
            >
              {s.name} ({fa(s.durationMin)} دقیقه)
            </button>
          ))}
        </div>
      </div>
      {b.seats.some((s) => s.active) ? (
        <label className="fin-field">
          <span className="fin-label">{seatWord(b)}</span>
          <select className="fin-input" value={seat} onChange={(e) => setSeat(e.target.value)} aria-label={seatWord(b)}>
            <option value="">فرقی نمی‌کند</option>
            {b.seats
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <SlotPicker b={b} serviceIds={svc} value={at} onChange={setAt} seatId={seat || null} />
      <TextInput label="نام مشتری" value={name} onChange={setName} />
      <label className="fin-field">
        <span className="fin-label">موبایل مشتری</span>
        <input className="fin-input" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="موبایل مشتری نوبت" />
      </label>
      <TextInput label="یادداشت" value={note} onChange={setNote} />
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            if (!at) return setErr('ساعت را انتخاب کنید.');
            let r: Booking | string = '';
            update((dr) => {
              r = addBooking(dr.biz!, { serviceIds: svc, customerName: name, customerPhone: phone, startsAt: at, seatId: seat || null, source: 'manual', note }, Date.now());
            });
            if (typeof r === 'string') setErr(r);
            else {
              setErr(null);
              onDone();
            }
          }}
        >
          ثبت نوبت
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </div>
  );
}

function BookingRow({ b, bk }: { b: Business; bk: Booking }) {
  const { update } = useFinance();
  const [mode, setMode] = useState<'done' | 'move' | null>(null);
  const [pay, setPay] = useState<PayMethod>('cash');
  const [to, setTo] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (s: BookingStatus, p?: PayMethod) => {
    let e: string | null = null;
    update((dr) => {
      e = setBookingStatus(dr, bk.id, s, Date.now(), p);
    });
    setErr(e);
    if (!e) setMode(null);
  };
  const seats = b.seats.filter((s) => s.active);
  return (
    <li className={`fin-list-block biz-booking ${bk.status}`} data-testid="biz-booking">
      <div className="fin-list-row">
        <span className="fin-list-main">
          <b>
            {faTime(bk.startsAt)} · {bk.customerName ?? bk.customerPhone}
          </b>
          <small>
            {bk.serviceNames.join(' + ')}، {fa(bk.durationMin)} دقیقه
            {bk.source !== 'manual' ? `، ${bk.source === 'web' ? 'از صفحه آنلاین' : 'از تلگرام'}` : ''}
            {bk.note ? `، ${bk.note}` : ''}
          </small>
        </span>
        <span className="fin-list-nums">
          <Money rial={bk.priceRial} />
          <small className={`biz-status ${bk.status}`}>{BOOKING_STATUS_LABEL[bk.status]}</small>
        </span>
      </div>
      <div className="fin-actions">
        {bk.status === 'pending' ? (
          <button className="fin-mini" onClick={() => set('confirmed')}>
            ✓ قطعی کن
          </button>
        ) : null}
        {bk.status === 'pending' || bk.status === 'confirmed' ? (
          <>
            <button className="fin-mini" onClick={() => setMode(mode === 'done' ? null : 'done')}>
              ✂ انجام شد
            </button>
            <button className="fin-mini ghost" onClick={() => setMode(mode === 'move' ? null : 'move')}>
              جابه‌جایی
            </button>
            <button className="fin-mini ghost" onClick={() => window.confirm('این نوبت لغو شود؟') && set('canceled')}>
              لغو
            </button>
          </>
        ) : null}
        {bk.status === 'done' ? (
          <button className="fin-mini ghost" onClick={() => window.confirm('«انجام شد» برداشته شود؟ فروشش هم لغو می‌شود.') && set('confirmed')}>
            برگرداندن
          </button>
        ) : null}
        {seats.length && bk.status !== 'canceled' ? (
          <select
            className="fin-input sm"
            value={bk.seatId ?? ''}
            onChange={(e) => {
              let er: string | null = null;
              update((dr) => {
                er = assignSeat(dr.biz!, bk.id, e.target.value || null);
              });
              setErr(er);
            }}
            aria-label={`${seatWord(b)} این نوبت`}
          >
            <option value="">بدون {seatWord(b)}</option>
            {seats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        <a className="fin-mini ghost" href={smsHref([bk.customerPhone], `نوبت شما در ${b.name}: ${fmtDateFa(tehranParts(bk.startsAt).date)} ساعت ${faTime(bk.startsAt)}.`)}>
          ✉ پیامک
        </a>
      </div>
      {mode === 'done' ? (
        <div className="biz-confirm">
          <PayPicker b={b} value={pay} onChange={setPay} />
          <button className="fin-mini" onClick={() => set('done', pay)}>
            ثبت فروش <Money rial={bk.priceRial} />
          </button>
        </div>
      ) : null}
      {mode === 'move' ? (
        <div className="fin-grid">
          <SlotPicker b={b} serviceIds={bk.serviceIds} value={to} onChange={setTo} excludeId={bk.id} seatId={bk.seatId} />
          <button
            className="fin-mini"
            disabled={!to}
            onClick={() => {
              let e: string | null = null;
              update((dr) => {
                e = rescheduleBooking(dr.biz!, bk.id, to!, Date.now());
              });
              setErr(e);
              if (!e) setMode(null);
            }}
          >
            ثبت زمان تازه
          </button>
        </div>
      ) : null}
      {err ? <p className="fin-err">{err}</p> : null}
    </li>
  );
}

function Calendar({ b }: { b: Business }) {
  const { today } = useFinance();
  const [week, setWeek] = useState(saturdayOf(today));
  const [adding, setAdding] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDay = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const bk of b.bookings) {
      const d = tehranParts(bk.startsAt).date;
      if (d < week || d > addDays(week, 6)) continue;
      m.set(d, [...(m.get(d) ?? []), bk]);
    }
    for (const l of m.values()) l.sort((a, c) => a.startsAt - c.startsAt);
    return m;
  }, [b.bookings, week]);
  const pending = b.bookings.filter((x) => x.status === 'pending').length;
  return (
    <>
      <div className="fin-actions">
        <button className="btn" onClick={() => setAdding((v) => !v)} aria-expanded={adding} disabled={!b.services.some((s) => s.active)}>
          {adding ? 'بستن' : '+ نوبت دستی'}
        </button>
        {pending ? <span className="banner warn small">{fa(pending)} نوبت منتظر تأیید</span> : null}
      </div>
      {!b.services.length ? <p className="banner info">اول در «خدمات» خدمت‌ها و مدت هرکدام را تعریف کنید.</p> : null}
      {adding ? (
        <Card title="نوبت تازه">
          <NewBooking b={b} onDone={() => setAdding(false)} />
        </Card>
      ) : null}
      <div className="fin-monthnav">
        <button className="fin-mini" onClick={() => setWeek(addDays(week, -7))} aria-label="هفته قبل">
          ‹ قبلی
        </button>
        <b>
          هفته {fmtDateFa(week)} تا {fmtDateFa(addDays(week, 6))}
        </b>
        <button className="fin-mini" onClick={() => setWeek(addDays(week, 7))} aria-label="هفته بعد">
          بعدی ›
        </button>
      </div>
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const h = b.hours.find((x) => x.weekday === weekdayOf(d));
        return (
          <Card key={d} title={`${WEEKDAYS_FA[weekdayOf(d)]} ${fmtDateFa(d)}${d === today ? ' (امروز)' : ''}`} className={d === today ? 'biz-today' : ''}>
            {list.length ? (
              <ul className="fin-list">
                {list.map((bk) => (
                  <BookingRow key={bk.id} b={b} bk={bk} />
                ))}
              </ul>
            ) : (
              <p className="muted small">{h && !h.open ? 'تعطیل' : 'نوبتی نیست'}</p>
            )}
          </Card>
        );
      })}
    </>
  );
}

function Services({ b }: { b: Business }) {
  const { update } = useFinance();
  const [name, setName] = useState('');
  const [dur, setDur] = useState('30');
  const [price, setPrice] = useState('');
  const [cat, setCat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const tpl = templatesFor(b.type).filter((t) => !b.services.some((s) => s.name === t.productName));
  return (
    <>
      <Card title="خدمت تازه">
        <div className="fin-grid">
          <TextInput label="نام خدمت" value={name} onChange={setName} placeholder="مثلاً اصلاح مو" />
          <NumInput label="مدت (دقیقه)" value={dur} onChange={setDur} />
          <TomanInput label="قیمت (تومان)" value={price} onChange={setPrice} />
          <TextInput label="دسته (اختیاری)" value={cat} onChange={setCat} />
          <div className="fin-span fin-actions">
            <button
              className="btn"
              onClick={() => {
                const d = Math.round(parseAmount(dur));
                if (!name.trim() || !(d > 0)) return setErr('نام و مدت (بیشتر از صفر) را بنویسید.');
                update((dr) => void dr.biz!.services.push({ id: newId('s'), name: name.trim(), durationMin: d, priceRial: tomanToRial(parseAmount(price) || 0), category: cat.trim() || null, active: true }));
                setName('');
                setPrice('');
                setErr(null);
              }}
            >
              افزودن
            </button>
            {err ? <span className="fin-err">{err}</span> : null}
          </div>
        </div>
      </Card>
      <ul className="fin-list">
        {b.services.map((s) => (
          <li key={s.id} className="fin-list-row">
            <span className="fin-list-main">
              <b>
                {s.name}
                {s.active ? '' : ' (خاموش)'}
              </b>
              <small>
                {fa(s.durationMin)} دقیقه{s.category ? `، ${s.category}` : ''}
              </small>
            </span>
            <span className="fin-list-nums">
              <Money rial={s.priceRial} />
              <button className="fin-mini ghost" onClick={() => update((dr) => void (dr.biz!.services.find((x) => x.id === s.id)!.active = !s.active))}>
                {s.active ? 'خاموش' : 'روشن'}
              </button>
              <button
                className="fin-mini ghost"
                onClick={() => {
                  const p = window.prompt(`قیمت تازه «${s.name}» (تومان):`, String(rialToTomanN(s.priceRial)));
                  if (p !== null && parseAmount(p) >= 0) update((dr) => void (dr.biz!.services.find((x) => x.id === s.id)!.priceRial = tomanToRial(parseAmount(p))));
                }}
              >
                قیمت
              </button>
            </span>
          </li>
        ))}
      </ul>
      {tpl.length && typeInfo(b.type).kind === 'service' ? (
        <Card title="خدمت‌های رایج">
          <ul className="fin-list">
            {tpl.slice(0, 20).map((t) => (
              <li key={t.key} className="fin-list-row">
                <span>
                  {t.icon} {t.productName} ({fa(t.prepMin ?? 30)} دقیقه)
                </span>
                <span className="fin-list-nums">
                  <Money rial={tomanToRial(t.suggestedPrice)} />
                  <button
                    className="fin-mini"
                    onClick={() => update((dr) => void dr.biz!.services.push({ id: newId('s'), name: t.productName, durationMin: t.prepMin ?? 30, priceRial: tomanToRial(t.suggestedPrice), category: t.category, active: true }))}
                  >
                    افزودن
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Hours({ b }: { b: Business }) {
  const { update } = useFinance();
  const [seat, setSeat] = useState('');
  const [wd, setWd] = useState(6);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('13:00');
  return (
    <>
      <Card title="ساعات کاری">
        <ul className="fin-list">
          {WEEK_ORDER.map((w) => {
            const h = b.hours.find((x) => x.weekday === w)!;
            const set = (patch: Partial<typeof h>) => update((dr) => void Object.assign(dr.biz!.hours.find((x) => x.weekday === w)!, patch));
            return (
              <li key={w} className="fin-list-row biz-hour">
                <label className="biz-check">
                  <input type="checkbox" checked={h.open} onChange={(e) => set({ open: e.target.checked })} /> {WEEKDAYS_FA[w]}
                </label>
                {h.open ? (
                  <span className="biz-inline">
                    <input className="fin-input sm" type="time" value={h.from} onChange={(e) => set({ from: e.target.value })} aria-label={`شروع ${WEEKDAYS_FA[w]}`} />
                    تا
                    <input className="fin-input sm" type="time" value={h.to} onChange={(e) => set({ to: e.target.value })} aria-label={`پایان ${WEEKDAYS_FA[w]}`} />
                  </span>
                ) : (
                  <small className="muted">تعطیل</small>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="شیفت‌ها (اختیاری)">
        <p className="small">برای کار دو نوبته (مثلاً صبح و عصر) یا وقتی هر {seatWord(b)} ساعت خودش را دارد. اگر برای روزی شیفت تعریف شود، به‌جای ساعت کاری همان روز به کار می‌رود.</p>
        <div className="biz-inline">
          <select className="fin-input sm" value={wd} onChange={(e) => setWd(+e.target.value)} aria-label="روز شیفت">
            {WEEK_ORDER.map((w) => (
              <option key={w} value={w}>
                {WEEKDAYS_FA[w]}
              </option>
            ))}
          </select>
          <input className="fin-input sm" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="شروع شیفت" />
          <input className="fin-input sm" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="پایان شیفت" />
          {b.seats.length ? (
            <select className="fin-input sm" value={seat} onChange={(e) => setSeat(e.target.value)} aria-label={`${seatWord(b)} شیفت`}>
              <option value="">همه</option>
              {b.seats.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <button className="fin-mini" disabled={to <= from} onClick={() => update((dr) => void dr.biz!.shifts.push({ id: newId('h'), seatId: seat || null, weekday: wd, from, to, active: true }))}>
            افزودن شیفت
          </button>
        </div>
        <ul className="fin-list">
          {b.shifts.map((s) => (
            <li key={s.id} className="fin-list-row">
              <span>
                {WEEKDAYS_FA[s.weekday]} {s.from} تا {s.to}
                {s.seatId ? `، ${b.seats.find((x) => x.id === s.seatId)?.name ?? ''}` : ''}
              </span>
              <button className="fin-mini ghost" onClick={() => update((dr) => void (dr.biz!.shifts = dr.biz!.shifts.filter((x) => x.id !== s.id)))}>
                حذف
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Seats({ b }: { b: Business }) {
  const { update } = useFinance();
  const [name, setName] = useState('');
  const [cap, setCap] = useState('1');
  const w = seatWord(b);
  return (
    <Card title={`${w}‌ها`}>
      <p className="small">
        هر {w} هم‌زمان یک نوبت می‌پذیرد؛ با دو {w}، دو مشتری در یک ساعت نوبت می‌گیرند. بدون {w}، کسب‌وکار در هر زمان یک نوبت دارد.
      </p>
      <div className="biz-inline">
        <input className="fin-input sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={`مثلاً ${w} ۱`} aria-label={`نام ${w}`} />
        <input className="fin-input sm" dir="ltr" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="ظرفیت (نفر)" />
        <button
          className="fin-mini"
          disabled={!name.trim() || b.seats.some((s) => s.name === name.trim())}
          onClick={() => {
            update((dr) => void dr.biz!.seats.push({ id: newId('u'), name: name.trim(), capacity: Math.max(1, Math.round(parseAmount(cap) || 1)), active: true }));
            setName('');
          }}
        >
          افزودن
        </button>
      </div>
      <ul className="fin-list">
        {b.seats.map((s) => (
          <li key={s.id} className="fin-list-row">
            <span>
              {s.name} ({fa(s.capacity)} نفر){s.active ? '' : '، خاموش'}
            </span>
            <span className="fin-actions">
              <button className="fin-mini ghost" onClick={() => update((dr) => void (dr.biz!.seats.find((x) => x.id === s.id)!.active = !s.active))}>
                {s.active ? 'خاموش' : 'روشن'}
              </button>
              <button
                className="fin-mini ghost"
                onClick={() =>
                  window.confirm(`«${s.name}» حذف شود؟ نوبت‌های گذشته می‌مانند.`) &&
                  update((dr) => {
                    const biz = dr.biz!;
                    biz.seats = biz.seats.filter((x) => x.id !== s.id);
                    biz.shifts = biz.shifts.filter((x) => x.seatId !== s.id);
                    for (const bk of biz.bookings) if (bk.seatId === s.id) bk.seatId = null;
                  })
                }
              >
                حذف
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BookingPage({ b }: { b: Business }) {
  const [tab, setTab] = useState<'cal' | 'svc' | 'hours' | 'seats'>('cal');
  return (
    <>
      <Chips
        label="بخش"
        value={tab}
        onChange={setTab}
        options={[
          { key: 'cal', label: 'نوبت‌ها' },
          { key: 'svc', label: 'خدمات', count: b.services.length },
          { key: 'hours', label: 'ساعات و شیفت' },
          { key: 'seats', label: `${seatWord(b)}‌ها`, count: b.seats.length },
        ]}
      />
      {tab === 'cal' ? <Calendar b={b} /> : tab === 'svc' ? <Services b={b} /> : tab === 'hours' ? <Hours b={b} /> : <Seats b={b} />}
    </>
  );
}

export default function BookingView() {
  return (
    <WithBiz title="نوبت‌دهی" lede="خدمت‌ها با مدت، ساعت کاری و شیفت، صندلی یا میز؛ نوبت‌ها هیچ‌وقت روی هم نمی‌افتند. «انجام شد» فروش همان خدمت را ثبت می‌کند.">
      {(_d, b) => <BookingPage b={b} />}
    </WithBiz>
  );
}
