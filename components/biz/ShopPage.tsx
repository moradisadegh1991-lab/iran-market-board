'use client';
// The page a business's customers open (/shop?b=<slug>) — Kasbai's /o, /b and /shop pages in one:
// the menu with a cart, booking a time, and tracking what was sent. It reads only the published
// catalog (lib/biz/public.ts) and never the owner's book; it is shown without the app's own menus.
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { calendarOfCatalog, whenFa, type PublicCatalog } from '@/lib/biz/public';
import { availableSlots, tehranMs, tehranParts, weekdayOf } from '@/lib/biz/slots';
import { fmtToman } from '../finance/kit';

const fa = (n: number) => n.toLocaleString('fa-IR');
const faDigits = (s: string) => s.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);
const WD = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
type Waiting = { startsAt: number; durationMin: number; seatId?: string | null }[];

async function post(path: string, body: unknown) {
  const r = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: 'خطای شبکه' }))) as { ok: boolean; id?: string; error?: string };
}

function Contact({ name, setName, phone, setPhone, note, setNote, noteLabel }: { name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void; note: string; setNote: (v: string) => void; noteLabel: string }) {
  return (
    <div className="fin-grid">
      <label className="fin-field">
        <span className="fin-label">نام شما</span>
        <input className="fin-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label="نام شما" />
      </label>
      <label className="fin-field">
        <span className="fin-label">موبایل</span>
        <input className="fin-input" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="09…" aria-label="موبایل" />
      </label>
      <label className="fin-field fin-span">
        <span className="fin-label">{noteLabel}</span>
        <input className="fin-input" value={note} onChange={(e) => setNote(e.target.value)} aria-label={noteLabel} />
      </label>
    </div>
  );
}

function Done({ slug, id, what }: { slug: string; id: string; what: string }) {
  return (
    <div className="panel pad shop-done" role="status" data-testid="shop-done">
      <h2>✅ {what} ثبت شد</h2>
      <p>
        کد پیگیری: <b dir="ltr">{id}</b>
      </p>
      <p className="small">کسب‌وکار باید آن را تأیید کند؛ وضعیتش را با همین کد پایین صفحه ببینید.</p>
      <Track slug={slug} initial={id} />
    </div>
  );
}

const STATUS: Record<string, string> = { pending: '⏳ منتظر تأیید', confirmed: '✅ تأیید شد', preparing: '👨‍🍳 در حال آماده‌سازی', delivered: '📦 تحویل شد', done: '✂ انجام شد', canceled: '❌ لغو شد' };

function Track({ slug, initial = '' }: { slug: string; initial?: string }) {
  const [id, setId] = useState(initial);
  const [res, setRes] = useState<string | null>(null);
  return (
    <div className="biz-inline">
      <input className="fin-input sm" dir="ltr" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder="کد پیگیری" aria-label="کد پیگیری" />
      <button
        className="fin-mini"
        onClick={async () => {
          const r = await fetch(api(`/api/biz/track?slug=${slug}&id=${encodeURIComponent(id.trim())}`)).then((x) => x.json()).catch(() => null);
          setRes(r?.ok ? `${r.kind === 'booking' ? 'نوبت' : 'سفارش'} (${r.summary}): ${STATUS[r.status] ?? r.status}` : r?.error ?? 'خطای شبکه');
        }}
      >
        وضعیت
      </button>
      {res ? <span className="small" data-testid="shop-status">{res}</span> : null}
    </div>
  );
}

function Menu({ cat }: { cat: PublicCatalog }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [c, setC] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = [...new Set(cat.products.map((p) => p.category?.trim()).filter(Boolean))] as string[];
  const shown = cat.products.filter((p) => (!c || p.category?.trim() === c) && (!q.trim() || p.name.includes(q.trim())));
  const lines = Object.entries(cart).map(([id, n]) => ({ p: cat.products.find((x) => x.id === id)!, n })).filter((l) => l.p && l.n > 0);
  const sub = lines.reduce((s, l) => s + l.n * l.p.priceRial, 0);
  const disc = Math.round((sub * (cat.discount?.pct ?? 0)) / 100);
  const total = sub - disc + Math.round(((sub - disc) * cat.vatPct) / 100);
  const step = (id: string, by: number) =>
    setCart((x) => {
      const n = { ...x, [id]: Math.max(0, Math.min(99, (x[id] ?? 0) + by)) };
      if (!n[id]) delete n[id];
      return n;
    });
  if (done) return <Done slug={cat.slug} id={done} what="سفارش شما" />;
  return (
    <>
      <input className="fin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در منو…" aria-label="جستجو در منو" />
      {cats.length > 1 ? (
        <div className="chips" role="radiogroup" aria-label="دسته‌ها">
          {['', ...cats].map((x) => (
            <button key={x} role="radio" aria-checked={c === x} onClick={() => setC(x)}>
              {x || 'همه'}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="shop-menu">
        {shown.map((p) => (
          <li key={p.id} data-testid="shop-item">
            {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : null}
            <span className="shop-item-main">
              <b>{p.name}</b>
              {p.description ? <small>{p.description}</small> : null}
              <span className="fin-money">{fmtToman(p.priceRial)}</span>
            </span>
            <span className="biz-stepper">
              {cart[p.id] ? (
                <>
                  <button className="fin-mini" onClick={() => step(p.id, -1)} aria-label={`کم کردن ${p.name}`}>
                    −
                  </button>
                  <b>{fa(cart[p.id])}</b>
                </>
              ) : null}
              <button className="fin-mini" onClick={() => step(p.id, 1)} aria-label={`افزودن ${p.name}`}>
                +
              </button>
            </span>
          </li>
        ))}
      </ul>
      {lines.length ? (
        <div className="shop-cart panel pad">
          <button className="pos-bar-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <span>🛒 {fa(lines.reduce((s, l) => s + l.n, 0))} قلم</span>
            <span className="fin-money">{fmtToman(total)}</span>
            <span aria-hidden="true">{open ? '▼' : '▲'}</span>
          </button>
          {open ? (
            <>
              <ul className="pos-lines">
                {lines.map((l) => (
                  <li key={l.p.id}>
                    <span />
                    <b>{fa(l.n)}×</b>
                    <span />
                    <span className="pos-line-name">{l.p.name}</span>
                    <span className="fin-money">{fmtToman(l.n * l.p.priceRial)}</span>
                  </li>
                ))}
              </ul>
              {disc ? <p className="small">تخفیف «{cat.discount!.title}»: {fmtToman(-disc)}</p> : null}
              <Contact name={name} setName={setName} phone={phone} setPhone={setPhone} note={note} setNote={setNote} noteLabel="آدرس یا توضیح (اختیاری)" />
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await post('/api/biz/order', { slug: cat.slug, name, phone, note, items: lines.map((l) => ({ id: l.p.id, qty: l.n })) });
                  setBusy(false);
                  if (r.ok && r.id) setDone(r.id);
                  else setErr(r.error ?? 'ثبت نشد.');
                }}
              >
                {busy ? '…' : `ثبت سفارش (${fmtToman(total)})`}
              </button>
              {err ? <p className="fin-err">{err}</p> : null}
              <p className="muted small">پرداخت هنگام تحویل یا طبق هماهنگی با کسب‌وکار است؛ این صفحه پول نمی‌گیرد.</p>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Book({ cat, waiting }: { cat: PublicCatalog; waiting: Waiting }) {
  const [svc, setSvc] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dur = svc.reduce((s, id) => s + (cat.services.find((x) => x.id === id)?.durationMin ?? 0), 0);
  const cal = useMemo(() => calendarOfCatalog(cat, waiting), [cat, waiting]);
  const days = useMemo(() => {
    if (!dur) return [];
    const now = Date.now();
    const out: string[] = [];
    let d = tehranParts(now).date;
    for (let i = 0; i < 21 && out.length < 10; i++) {
      if (availableSlots(cal, d, dur, now).length) out.push(d);
      d = tehranParts(tehranMs(d, '12:00') + 86_400_000).date;
    }
    return out;
  }, [cal, dur]);
  const slots = day && dur ? availableSlots(cal, day, dur, Date.now()) : [];
  if (done) return <Done slug={cat.slug} id={done} what={`نوبت ${at ? whenFa(at) : ''}`} />;
  return (
    <>
      <span className="fin-label">خدمت‌ها (چندتایی هم می‌شود)</span>
      <div className="chips" role="group" aria-label="خدمت‌ها">
        {cat.services.map((s) => (
          <button
            key={s.id}
            aria-pressed={svc.includes(s.id)}
            onClick={() => {
              setSvc((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]));
              setDay(null);
              setAt(null);
            }}
          >
            {s.name} ({fa(s.durationMin)} دقیقه، {fmtToman(s.priceRial)})
          </button>
        ))}
      </div>
      {dur ? (
        days.length ? (
          <>
            <span className="fin-label">روز</span>
            <div className="chips" role="radiogroup" aria-label="روز">
              {days.map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={day === d}
                  onClick={() => {
                    setDay(d);
                    setAt(null);
                  }}
                >
                  {WD[weekdayOf(d)]} {new Date(`${d}T12:00:00Z`).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' })}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="banner warn">در سه هفته آینده زمان خالی نیست؛ با کسب‌وکار تماس بگیرید.</p>
        )
      ) : null}
      {day ? (
        <>
          <span className="fin-label">ساعت</span>
          <div className="chips biz-slots" role="radiogroup" aria-label="ساعت">
            {slots.map((t) => (
              <button key={t} role="radio" aria-checked={at === t} onClick={() => setAt(t)}>
                {faDigits(tehranParts(t).time)}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {at ? (
        <>
          <Contact name={name} setName={setName} phone={phone} setPhone={setPhone} note={note} setNote={setNote} noteLabel="توضیح (اختیاری)" />
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await post('/api/biz/book', { slug: cat.slug, name, phone, note, serviceIds: svc, startsAt: at });
              setBusy(false);
              if (r.ok && r.id) setDone(r.id);
              else setErr(r.error ?? 'ثبت نشد.');
            }}
          >
            {busy ? '…' : `ثبت نوبت ${whenFa(at)}`}
          </button>
          {err ? <p className="fin-err">{err}</p> : null}
        </>
      ) : null}
    </>
  );
}

function Shop() {
  const slug = (useSearchParams().get('b') ?? '').toLowerCase();
  const [state, setState] = useState<{ cat: PublicCatalog; waiting: Waiting; bot: string | null } | { error: string } | null>(null);
  const [tab, setTab] = useState<'menu' | 'book'>('menu');
  useEffect(() => {
    if (!slug) return setState({ error: 'لینک کامل نیست.' });
    fetch(api(`/api/biz/public?slug=${encodeURIComponent(slug)}`))
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) return setState({ error: j.error ?? 'پیدا نشد.' });
        setState({ cat: j.catalog, waiting: j.waiting ?? [], bot: j.bot ?? null });
        setTab(j.catalog.kind === 'service' && j.catalog.services.length ? 'book' : j.catalog.products.length ? 'menu' : 'book');
      })
      .catch(() => setState({ error: 'اتصال برقرار نشد؛ دوباره امتحان کنید.' }));
  }, [slug]);
  if (!state) return <p className="muted state">در حال بارگذاری…</p>;
  if ('error' in state) return <p className="banner warn">{state.error}</p>;
  const { cat, waiting, bot } = state;
  const h = cat.hours.find((x) => x.weekday === tehranParts(Date.now()).weekday);
  return (
    <>
      <header className="shop-head">
        <h1>{cat.name}</h1>
        <p className="small">
          {[cat.city, cat.address].filter(Boolean).join('، ')}
          {cat.city || cat.address ? ' · ' : ''}
          {h && h.open ? `امروز ${faDigits(h.from)} تا ${faDigits(h.to)}` : 'امروز تعطیل'}
          {cat.phone ? (
            <>
              {' · '}
              <a href={`tel:${cat.phone}`} dir="ltr">
                {cat.phone}
              </a>
            </>
          ) : null}
        </p>
        {cat.discount ? (
          <p className="banner info small">
            🏷 {cat.discount.title}: {fa(cat.discount.pct)}٪ تخفیف
          </p>
        ) : null}
      </header>
      {cat.products.length && cat.services.length ? (
        <div className="seg" role="tablist">
          <button role="tab" aria-pressed={tab === 'menu'} aria-selected={tab === 'menu'} onClick={() => setTab('menu')}>
            🛍 منو و سفارش
          </button>
          <button role="tab" aria-pressed={tab === 'book'} aria-selected={tab === 'book'} onClick={() => setTab('book')}>
            📅 رزرو نوبت
          </button>
        </div>
      ) : null}
      <section className="shop-body">{tab === 'menu' && cat.products.length ? <Menu cat={cat} /> : cat.services.length ? <Book cat={cat} waiting={waiting} /> : <p className="empty">هنوز چیزی منتشر نشده.</p>}</section>
      <footer className="shop-foot small">
        <span>پیگیری:</span> <Track slug={cat.slug} />
        {bot ? (
          <p>
            در تلگرام هم:{' '}
            <a href={`https://t.me/${bot}?start=b_${cat.slug}`} target="_blank" rel="noreferrer">
              @{bot}
            </a>
          </p>
        ) : null}
        <p className="muted">ساخته‌شده با «مالی من». اطلاعاتی که این‌جا می‌نویسید فقط برای همین کسب‌وکار فرستاده می‌شود.</p>
      </footer>
    </>
  );
}

export default function ShopPage() {
  return (
    <div className="wrap shop">
      <Suspense fallback={null}>
        <Shop />
      </Suspense>
    </div>
  );
}
