'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { SOLD, type Business, type Channel, type PayMethod } from '@/lib/biz/model';
import { activeDiscounts, orderTotals, quickSale } from '@/lib/biz/ops';
import { useFinance } from '../finance/FinanceProvider';
import { Money } from '../finance/kit';
import { fa, PayPicker, WithBiz } from './kit';

type Key = string; // `${kind}:${id}`

function Pos({ b }: { b: Business }) {
  const { update, today } = useFinance();
  const router = useRouter();
  const [cart, setCart] = useState<Record<Key, number>>({});
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('__all__');
  const [open, setOpen] = useState(false);
  const [discountId, setDiscountId] = useState('');
  const [channel, setChannel] = useState<Channel>('walkin');
  const [pay, setPay] = useState<PayMethod>('cash');
  const [creditId, setCreditId] = useState('');
  const [showCustomer, setShowCustomer] = useState(false);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  // a walk-in sale is usually handed over on the spot; kept for the whole shift
  const [deliver, setDeliver] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // best sellers first: the 8–10 items a counter sells all day should not need a search
  const rank = useMemo(() => {
    const tally = new Map<string, number>();
    for (const o of b.orders.slice(-300)) if (SOLD.includes(o.status)) for (const l of o.lines) tally.set(`${l.kind}:${l.itemId}`, (tally.get(`${l.kind}:${l.itemId}`) ?? 0) + l.qty);
    return tally;
  }, [b.orders]);
  const items = useMemo(
    () => [
      ...b.products.filter((p) => p.active).map((p) => ({ key: `product:${p.id}`, id: p.id, kind: 'product' as const, name: p.name, price: p.priceRial, cat: p.category?.trim() || '' })),
      ...b.services.filter((s) => s.active).map((s) => ({ key: `service:${s.id}`, id: s.id, kind: 'service' as const, name: s.name, price: s.priceRial, cat: s.category?.trim() || 'خدمات' })),
    ],
    [b.products, b.services],
  );
  const cats = useMemo(() => [...new Set(items.map((i) => i.cat).filter(Boolean))], [items]);
  const shown = items
    .filter((i) => (cat === '__all__' || i.cat === cat) && (!q.trim() || i.name.includes(q.trim())))
    .sort((a, c) => (rank.get(c.key) ?? 0) - (rank.get(a.key) ?? 0));
  const top = new Set([...rank.entries()].sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k]) => k));

  const lines = Object.entries(cart)
    .filter(([, n]) => n > 0)
    .map(([key, qty]) => ({ ...items.find((i) => i.key === key)!, qty }))
    .filter((l) => l.id);
  const discounts = activeDiscounts(b, today);
  const disc = discounts.find((x) => x.id === discountId);
  const t = orderTotals(lines.map((l) => ({ qty: l.qty, unitRial: l.price })), disc?.pct ?? 0, b.vatPct);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const add = (k: Key) => setCart((c) => ({ ...c, [k]: (c[k] ?? 0) + 1 }));
  const sub = (k: Key) =>
    setCart((c) => {
      const n = { ...c, [k]: (c[k] ?? 0) - 1 };
      if (n[k] <= 0) delete n[k];
      return n;
    });
  const clear = () => {
    setCart({});
    setDiscountId('');
    setCName('');
    setCPhone('');
    setCreditId('');
    setOpen(false);
  };

  function sell(then: 'next' | 'invoice') {
    if (!lines.length) return;
    let r: ReturnType<typeof quickSale> = '';
    update((dr) => {
      r = quickSale(dr, {
        items: lines.map((l) => ({ itemId: l.id, kind: l.kind, qty: l.qty })),
        channel,
        customerName: cName,
        customerPhone: cPhone,
        discountId: discountId || null,
        at: Date.now(),
        pay,
        creditId: pay === 'credit' ? creditId || null : null,
        deliver,
      });
    });
    const o = r as ReturnType<typeof quickSale>;
    if (typeof o === 'string') {
      setMsg({ ok: false, text: o });
      return;
    }
    clear();
    if (then === 'invoice') router.push(`/biz/orders?invoice=${o.id}`);
    else {
      setMsg({ ok: true, text: `فاکتور ${fa(o.no)} ثبت شد (${fa(Math.round(o.totalRial / 10))} تومان) — آماده سفارش بعدی.` });
      search.current?.focus();
    }
  }

  return (
    <>
      <input ref={search} className="fin-input biz-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی محصول…" aria-label="جستجوی محصول" />
      {cats.length > 1 ? (
        <div className="chips biz-cats" role="radiogroup" aria-label="دسته‌ها">
          {['__all__', ...cats].map((c) => (
            <button key={c} role="radio" aria-checked={cat === c} onClick={() => setCat(c)}>
              {c === '__all__' ? 'همه' : c}
            </button>
          ))}
        </div>
      ) : null}
      <div className="pos-grid">
        {shown.map((i) => (
          <button key={i.key} className={`pos-tile${cart[i.key] ? ' on' : ''}`} onClick={() => add(i.key)} aria-label={`افزودن ${i.name}`}>
            {!q && top.has(i.key) ? (
              <span className="pos-fire" aria-hidden="true">
                🔥
              </span>
            ) : null}
            {cart[i.key] ? <span className="pos-badge">{fa(cart[i.key])}</span> : null}
            <span className="pos-name">{i.name}</span>
            <Money rial={i.price} className="pos-price" />
          </button>
        ))}
        {!items.length ? (
          <p className="muted">
            محصولی نیست — اول از <Link href="/biz/products">محصولات و منو</Link> اضافه کنید.
          </p>
        ) : null}
      </div>

      {msg ? <p className={msg.ok ? 'banner info' : 'banner warn'} role="status">{msg.text}</p> : null}

      {lines.length ? (
        open ? (
          <div className="pos-receipt" role="region" aria-label="سبد فروش">
            <button className="fin-mini ghost" onClick={() => setOpen(false)}>
              ▼ بستن و ادامه انتخاب
            </button>
            <ul className="pos-lines">
              {lines.map((l) => (
                <li key={l.key}>
                  <button className="fin-mini" onClick={() => sub(l.key)} aria-label={`کم کردن ${l.name}`}>
                    −
                  </button>
                  <b>{fa(l.qty)}</b>
                  <button className="fin-mini" onClick={() => add(l.key)} aria-label={`اضافه کردن ${l.name}`}>
                    +
                  </button>
                  <span className="pos-line-name">{l.name}</span>
                  <Money rial={l.qty * l.price} />
                </li>
              ))}
            </ul>
            <div className="pos-extras">
              {discounts.length ? (
                <select className="fin-input sm" value={discountId} onChange={(e) => setDiscountId(e.target.value)} aria-label="تخفیف">
                  <option value="">بدون تخفیف</option>
                  {discounts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title} ({fa(x.pct)}٪)
                    </option>
                  ))}
                </select>
              ) : null}
              <select className="fin-input sm" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} aria-label="کانال فروش">
                <option value="walkin">🚶 حضوری</option>
                <option value="phone">📞 تلفنی</option>
                <option value="instagram">📷 اینستاگرام</option>
              </select>
              <button className="linkish" onClick={() => setShowCustomer((v) => !v)}>
                {showCustomer ? 'بستن مشخصات مشتری' : '+ مشخصات مشتری (اختیاری)'}
              </button>
            </div>
            {showCustomer || pay === 'credit' ? (
              <div className="fin-grid">
                <label className="fin-field">
                  <span className="fin-label">نام مشتری</span>
                  <input className="fin-input" value={cName} onChange={(e) => setCName(e.target.value)} aria-label="نام مشتری" />
                </label>
                <label className="fin-field">
                  <span className="fin-label">موبایل مشتری</span>
                  <input className="fin-input" dir="ltr" inputMode="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} aria-label="موبایل مشتری" />
                </label>
              </div>
            ) : null}
            <PayPicker b={b} value={pay} onChange={setPay} />
            {pay === 'credit' && b.credit.length ? (
              <select className="fin-input sm" value={creditId} onChange={(e) => setCreditId(e.target.value)} aria-label="بدهکار دفتر نسیه">
                <option value="">بدهکار تازه با نام بالا</option>
                {b.credit.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="pos-sum">
              <span>{fa(count)} قلم</span>
              {t.discountRial ? (
                <span>
                  تخفیف <Money rial={-t.discountRial} />
                </span>
              ) : null}
              {t.vatRial ? (
                <span>
                  ارزش افزوده <Money rial={t.vatRial} />
                </span>
              ) : null}
              <b data-testid="pos-total">
                <Money rial={t.totalRial} />
              </b>
            </div>
            <label className="biz-check">
              <input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} /> تحویل شد (مشتری همین‌جا گرفت)
            </label>
            <div className="fin-actions">
              <button className="btn ghost" onClick={clear}>
                پاک کردن
              </button>
              <button className="btn ghost" onClick={() => sell('invoice')}>
                🧾 ثبت و فاکتور
              </button>
              <button className="btn" onClick={() => sell('next')}>
                ثبت و بعدی
              </button>
            </div>
          </div>
        ) : (
          <div className="pos-bar">
            <button className="pos-bar-main" onClick={() => setOpen(true)} aria-label="نمایش سبد فروش">
              <span>{fa(count)} قلم</span>
              <Money rial={t.totalRial} />
              <span aria-hidden="true">▲</span>
            </button>
            <button className="btn" onClick={() => setOpen(true)}>
              تسویه
            </button>
          </div>
        )
      ) : null}
    </>
  );
}

export default function PosView() {
  return <WithBiz title="صندوق فروش" lede="روی هر قلم بزنید تا به سبد برود؛ پرداخت نقد و کارت در حساب‌های کسب‌وکار و نسیه در دفتر نسیه ثبت می‌شود.">{(_d, b) => <Pos b={b} />}</WithBiz>;
}
