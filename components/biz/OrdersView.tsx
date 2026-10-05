'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CHANNEL_LABEL, PAY_LABEL, SOLD, STATUS_LABEL, type Business, type Channel, type Order, type OrderStatus, type PayMethod } from '@/lib/biz/model';
import { activeDiscounts, cancelOrder, confirmOrder, createOrder, orderTotals, setOrderStatus } from '@/lib/biz/ops';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtDateFa, fmtToman, Money } from '../finance/kit';
import { downloadPng, fa, faTime, PayPicker, smsHref, WithBiz } from './kit';

// ── the invoice ────────────────────────────────────────────────────────────

function invoiceLines(b: Business, o: Order): string[] {
  const out = [b.name, `فاکتور ${fa(o.no)} — ${fmtDateFa(o.saleDate ?? o.date)} ساعت ${o.saleTime ?? o.time}`];
  if (o.customerName || o.customerPhone) out.push(`مشتری: ${[o.customerName, o.customerPhone].filter(Boolean).join(' ')}`);
  out.push('');
  for (const l of o.lines) out.push(`${l.name} × ${fa(l.qty)}: ${fmtToman(l.qty * l.unitRial)}`);
  out.push('', `جمع اقلام: ${fmtToman(o.subtotalRial)}`);
  if (o.discountRial) out.push(`تخفیف${o.discountTitle ? ` «${o.discountTitle}»` : ''} (${fa(o.discountPct)}٪): ${fmtToman(-o.discountRial)}`);
  if (o.vatRial) out.push(`ارزش افزوده (${fa(o.vatPct)}٪): ${fmtToman(o.vatRial)}`);
  out.push(`مبلغ قابل پرداخت: ${fmtToman(o.totalRial)}`);
  if (o.pay) out.push(`پرداخت: ${PAY_LABEL[o.pay]}`);
  if (b.phone || b.address) out.push('', [b.address, b.phone].filter(Boolean).join(' — '));
  return out;
}

/**
 * The invoice as a picture. WebView cannot print (window.print does nothing there) and jsPDF cannot
 * shape Persian, which is why Kasbai photographed the DOM with html2canvas; drawing the text on a
 * canvas does the same with no library — the browser shapes it.
 */
async function invoicePng(lines: string[]): Promise<string> {
  await document.fonts?.ready;
  const W = 720;
  const lh = 40;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 60 + lines.length * lh + 40;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.direction = 'rtl';
  x.textAlign = 'right';
  x.fillStyle = '#16202d';
  lines.forEach((ln, i) => {
    x.font = i === 0 ? '700 34px Vazirmatn Variable, Tahoma, sans-serif' : ln.startsWith('مبلغ قابل پرداخت') ? '700 28px Vazirmatn Variable, Tahoma, sans-serif' : '24px Vazirmatn Variable, Tahoma, sans-serif';
    x.fillText(ln, W - 40, 70 + i * lh);
  });
  return c.toDataURL('image/png');
}

async function shareInvoice(b: Business, o: Order) {
  await downloadPng(`invoice-${o.no}.png`, await invoicePng(invoiceLines(b, o)));
}

function Invoice({ b, o, onClose }: { b: Business; o: Order; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const text = invoiceLines(b, o);
  return (
    <Card title={`فاکتور ${fa(o.no)}`} className="biz-invoice-card">
      <div className="biz-invoice" data-testid="invoice">
        <b>{b.name}</b>
        <small>
          فاکتور {fa(o.no)}، {fmtDateFa(o.saleDate ?? o.date)} ساعت {o.saleTime ?? o.time}
          {o.customerName || o.customerPhone ? `، ${[o.customerName, o.customerPhone].filter(Boolean).join(' ')}` : ''}
        </small>
        <ul>
          {o.lines.map((l, i) => (
            <li key={i}>
              <span>
                {l.name} × {fa(l.qty)}
              </span>
              <Money rial={l.qty * l.unitRial} />
            </li>
          ))}
          {o.discountRial ? (
            <li className="muted">
              <span>تخفیف ({fa(o.discountPct)}٪)</span>
              <Money rial={-o.discountRial} />
            </li>
          ) : null}
          {o.vatRial ? (
            <li className="muted">
              <span>ارزش افزوده ({fa(o.vatPct)}٪)</span>
              <Money rial={o.vatRial} />
            </li>
          ) : null}
          <li className="total">
            <span>قابل پرداخت{o.pay ? ` (${PAY_LABEL[o.pay]})` : ''}</span>
            <Money rial={o.totalRial} />
          </li>
        </ul>
      </div>
      <div className="fin-actions no-print">
        <button className="btn" onClick={() => shareInvoice(b, o).catch((e) => setErr(e instanceof Error ? e.message : 'ساخت تصویر ناموفق بود.'))}>
          🖼 تصویر فاکتور
        </button>
        <button className="btn ghost" onClick={() => window.print()}>
          🖨 چاپ
        </button>
        {o.customerPhone ? (
          <a className="btn ghost" href={smsHref([o.customerPhone], text.join('\n'))}>
            ✉ پیامک به مشتری
          </a>
        ) : null}
        <button className="fin-mini ghost" onClick={onClose}>
          بستن
        </button>
      </div>
      <p className="muted small no-print">چاپ فقط در مرورگر کار می‌کند؛ در اپ «تصویر فاکتور» را بزنید و از برگه اشتراک‌گذاری چاپ یا ارسال کنید.</p>
      {err ? <p className="fin-err">{err}</p> : null}
    </Card>
  );
}

// ── a manual order (phone, Instagram, SMS) ───────────────────────────────

function NewOrder({ b, onDone }: { b: Business; onDone: () => void }) {
  const { update, today } = useFinance();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState<Channel>('phone');
  const [discountId, setDiscountId] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const prods = b.products.filter((p) => p.active && p.name.includes(q.trim()));
  const discounts = activeDiscounts(b, today);
  const lines = Object.entries(cart).map(([id, qty]) => ({ qty, unitRial: b.products.find((p) => p.id === id)?.priceRial ?? 0 }));
  const t = orderTotals(lines, discounts.find((x) => x.id === discountId)?.pct ?? 0, b.vatPct);
  const step = (id: string, by: number) =>
    setCart((c) => {
      const n = { ...c, [id]: Math.max(0, (c[id] ?? 0) + by) };
      if (!n[id]) delete n[id];
      return n;
    });
  return (
    <>
      <input className="fin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی محصول…" aria-label="جستجوی محصول برای سفارش" />
      <ul className="fin-list biz-pick">
        {prods.map((p) => (
          <li key={p.id} className="fin-list-row">
            <span className="fin-list-main">
              <b>{p.name}</b>
              <small>
                <Money rial={p.priceRial} />
              </small>
            </span>
            <span className="biz-stepper">
              <button className="fin-mini" onClick={() => step(p.id, -1)} disabled={!cart[p.id]} aria-label={`کم کردن ${p.name}`}>
                −
              </button>
              <b>{fa(cart[p.id] ?? 0)}</b>
              <button className="fin-mini" onClick={() => step(p.id, 1)} aria-label={`اضافه کردن ${p.name}`}>
                +
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="fin-grid">
        <label className="fin-field">
          <span className="fin-label">کانال</span>
          <select className="fin-input" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} aria-label="کانال سفارش">
            {(['phone', 'walkin', 'instagram', 'sms'] as Channel[]).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        {discounts.length ? (
          <label className="fin-field">
            <span className="fin-label">تخفیف</span>
            <select className="fin-input" value={discountId} onChange={(e) => setDiscountId(e.target.value)} aria-label="تخفیف سفارش">
              <option value="">بدون تخفیف</option>
              {discounts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title} ({fa(x.pct)}٪)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="fin-field">
          <span className="fin-label">نام مشتری</span>
          <input className="fin-input" value={cName} onChange={(e) => setCName(e.target.value)} aria-label="نام مشتری سفارش" />
        </label>
        <label className="fin-field">
          <span className="fin-label">موبایل</span>
          <input className="fin-input" dir="ltr" inputMode="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} aria-label="موبایل مشتری سفارش" />
        </label>
        <label className="fin-field fin-span">
          <span className="fin-label">یادداشت (آدرس، توضیح)</span>
          <input className="fin-input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="یادداشت سفارش" />
        </label>
      </div>
      <p className="small">
        قابل پرداخت: <Money rial={t.totalRial} />. سفارش «در انتظار» ثبت می‌شود؛ با «تأیید» از انبار کم و پولش ثبت می‌شود.
      </p>
      <div className="fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: ReturnType<typeof createOrder> = '';
            update((dr) => {
              r = createOrder(dr.biz!, { items: Object.entries(cart).map(([itemId, qty]) => ({ itemId, qty })), channel, customerName: cName, customerPhone: cPhone, note, discountId: discountId || null, at: Date.now() });
            });
            const res = r as ReturnType<typeof createOrder>;
            if (typeof res === 'string') setErr(res);
            else {
              setCart({});
              setCName('');
              setCPhone('');
              setNote('');
              setErr(null);
              onDone();
            }
          }}
        >
          ثبت سفارش
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </>
  );
}

// ── the list ───────────────────────────────────────────────────────────────

function Confirm({ b, o }: { b: Business; o: Order }) {
  const { update } = useFinance();
  const [pay, setPay] = useState<PayMethod>('cash');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="biz-confirm">
      <PayPicker b={b} value={pay} onChange={setPay} />
      <button
        className="fin-mini"
        onClick={() => {
          let e: string | null = null;
          update((dr) => {
            e = confirmOrder(dr, o.id, pay, Date.now());
          });
          setErr(e);
        }}
      >
        ✓ تأیید
      </button>
      {err ? <span className="fin-err">{err}</span> : null}
    </div>
  );
}

function Orders({ b }: { b: Business }) {
  const { update } = useFinance();
  const params = useSearchParams();
  const [invoice, setInvoice] = useState<string | null>(params.get('invoice'));
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useMemo(
    () =>
      [...b.orders]
        .reverse()
        .filter((o) => (!status || o.status === status) && (!q.trim() || [o.customerName, o.customerPhone, o.note, String(o.no)].some((x) => (x ?? '').includes(q.trim()))))
        .slice(0, 200),
    [b.orders, status, q],
  );
  const inv = invoice ? b.orders.find((o) => o.id === invoice) : null;
  const pending = b.orders.filter((o) => o.status === 'pending').length;
  return (
    <>
      {inv ? <Invoice b={b} o={inv} onClose={() => setInvoice(null)} /> : null}
      <div className="fin-actions">
        <Link className="btn" href="/biz/pos">
          ⚡ فروش سریع
        </Link>
        <button className="btn ghost" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? 'بستن' : '+ سفارش تلفنی/دستی'}
        </button>
        {b.online ? (
          <Link className="btn ghost" href="/biz/online">
            🌐 سفارش‌های آنلاین
          </Link>
        ) : null}
      </div>
      {adding ? (
        <Card title="سفارش تازه">
          <NewOrder b={b} onDone={() => setAdding(false)} />
        </Card>
      ) : null}
      <div className="biz-filter">
        <input className="fin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، شماره یا شماره فاکتور…" aria-label="جستجوی سفارش" />
        <select className="fin-input sm" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | '')} aria-label="وضعیت">
          <option value="">همه ({fa(b.orders.length)})</option>
          {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
              {s === 'pending' && pending ? ` (${fa(pending)})` : ''}
            </option>
          ))}
        </select>
      </div>
      <ul className="fin-list biz-orders">
        {list.map((o) => (
          <li key={o.id} className={`fin-list-block biz-order ${o.status}`} data-testid="biz-order">
            <div className="fin-list-row">
              <span className="fin-list-main">
                <b>
                  فاکتور {fa(o.no)} · {CHANNEL_LABEL[o.channel]}
                </b>
                <small>
                  {fmtDateFa(o.date)} {faTime(o.at)}
                  {o.customerName || o.customerPhone ? `، ${[o.customerName, o.customerPhone].filter(Boolean).join(' ')}` : ''}
                  {o.note ? `، ${o.note}` : ''}
                </small>
                <small>{o.lines.map((l) => `${l.name}×${fa(l.qty)}`).join('، ')}</small>
              </span>
              <span className="fin-list-nums">
                <Money rial={o.totalRial} />
                <small className={`biz-status ${o.status}`}>
                  {STATUS_LABEL[o.status]}
                  {o.pay ? `، ${PAY_LABEL[o.pay]}` : ''}
                </small>
              </span>
            </div>
            <div className="fin-actions">
              {o.status === 'pending' ? <Confirm b={b} o={o} /> : null}
              {o.status === 'confirmed' ? (
                <button className="fin-mini" onClick={() => update((dr) => void setOrderStatus(dr.biz!, o.id, 'preparing'))}>
                  👨‍🍳 آماده‌سازی
                </button>
              ) : null}
              {o.status === 'confirmed' || o.status === 'preparing' ? (
                <button className="fin-mini" onClick={() => update((dr) => void setOrderStatus(dr.biz!, o.id, 'delivered'))}>
                  📦 تحویل
                </button>
              ) : null}
              {SOLD.includes(o.status) ? (
                <button className="fin-mini" onClick={() => setInvoice(o.id)}>
                  🧾 فاکتور
                </button>
              ) : null}
              {o.status !== 'canceled' ? (
                <button
                  className="fin-mini ghost"
                  onClick={() => {
                    if (!window.confirm(SOLD.includes(o.status) ? `فاکتور ${o.no} لغو شود؟ کالا به انبار و پولش از دفتر برمی‌گردد.` : `سفارش ${o.no} لغو شود؟`)) return;
                    update((dr) => void cancelOrder(dr, o.id, Date.now()));
                  }}
                >
                  لغو
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {!list.length ? <li className="empty">سفارشی نیست.</li> : null}
      </ul>
    </>
  );
}

export default function OrdersView() {
  return (
    <WithBiz title="سفارش‌ها و فاکتور" lede="سفارش همه کانال‌ها در یک صف: حضوری، تلفنی، اینستاگرام، صفحه آنلاین و تلگرام. تأیید = فاکتور، کسر از انبار و ثبت پول.">
      {(_d, b) => (
        <Suspense fallback={null}>
          <Orders b={b} />
        </Suspense>
      )}
    </WithBiz>
  );
}
