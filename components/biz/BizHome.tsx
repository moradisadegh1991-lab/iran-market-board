'use client';
import Link from 'next/link';
import { useState } from 'react';
import { accountBalances, addDays } from '@/lib/finance/calc';
import { isMoneyAccount, tomanToRial, type FinanceData } from '@/lib/finance/model';
import { BUSINESS_TYPES, typeInfo, type Business, type BusinessType } from '@/lib/biz/model';
import { compactBiz, ownerDraw, setupBusiness } from '@/lib/biz/ops';
import { dailyProfit, overview, sumRows } from '@/lib/biz/reports';
import { useFinance, WithBook } from '../finance/FinanceProvider';
import { Card, JalaliDate, Money, parseAmount, TextInput, TomanInput } from '../finance/kit';
import { PageHead } from '../ui';
import { BizTabs, fa } from './kit';
import { Art } from '../icons';

function Setup({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType>('cafe');
  const [phone, setPhone] = useState('');
  const [card, setCard] = useState('new');
  const [err, setErr] = useState<string | null>(null);
  const banks = d.accounts.filter((a) => isMoneyAccount(a) && a.kind === 'bank' && !a.bizId);
  return (
    <Card title="راه‌اندازی کسب‌وکار">
      <Art k="shop" className="art-hero" />
      <p className="small">
        مغازه، کافه، آرایشگاه یا هر کاری که دارید را این‌جا مدیریت کنید: صندوق فروش، سفارش از همه کانال‌ها، محصول با فرمول ساخت و بهای تمام‌شده، انبار، مشتری و نسیه، نوبت‌دهی،
        هزینه و سود، تحلیل فروش، برآورد مالیات و فروشگاه آنلاین با ربات تلگرام. پول کسب‌وکار در دو حساب همین دفتر می‌ماند — صندوق (نقد) و کارت مغازه — پس دارایی خالص شما
        کامل است، ولی فروش و هزینه مغازه با درآمد و خرج شخصی‌تان قاطی نمی‌شود؛ آن‌چه برای خودتان برمی‌دارید «برداشت از کسب‌وکار» است.
      </p>
      <div className="fin-grid">
        <TextInput label="نام کسب‌وکار" value={name} onChange={setName} placeholder="مثلاً کافه نارنج" />
        <label className="fin-field">
          <span className="fin-label">نوع کسب‌وکار</span>
          <select className="fin-input" value={type} onChange={(e) => setType(e.target.value as BusinessType)} aria-label="نوع کسب‌وکار">
            {BUSINESS_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-label">تلفن کسب‌وکار (اختیاری)</span>
          <input className="fin-input" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="تلفن کسب‌وکار" />
        </label>
        <label className="fin-field">
          <span className="fin-label">کارت یا حساب بانکی مغازه</span>
          <select className="fin-input" value={card} onChange={(e) => setCard(e.target.value)} aria-label="کارت یا حساب بانکی مغازه">
            <option value="new">حساب تازه «کارت {name.trim() || 'مغازه'}»</option>
            {banks.map((a) => (
              <option key={a.id} value={a.id}>
                همین حساب من: {a.name}
              </option>
            ))}
            <option value="none">ندارد — فقط نقد</option>
          </select>
        </label>
        <p className="fin-span muted small">
          اگر کارت مغازه همان کارتی است که پیامک بانکش در «ورود از بانک و پیامک» می‌آید، همان را انتخاب کنید تا موجودی‌اش از پیامک بانک بیاید. فروش کارتی صندوق در همان حساب
          ثبت می‌شود؛ پیامک واریزِ همان فروش را در صف ورود تأیید نکنید تا دوبار ثبت نشود.
        </p>
        <div className="fin-span fin-actions">
          <button
            className="btn"
            onClick={() => {
              let e: string | null = null;
              update((dr) => {
                e = setupBusiness(dr, { name, type, phone, card, now: Date.now(), today });
              });
              setErr(e);
            }}
          >
            ساخت کسب‌وکار
          </button>
          {err ? <span className="fin-err">{err}</span> : null}
        </div>
      </div>
    </Card>
  );
}

function Checklist({ b }: { b: Business }) {
  const service = typeInfo(b.type).kind === 'service';
  const steps = [
    { done: service ? b.services.length > 0 : b.products.length > 0, label: service ? 'خدمات و مدت هرکدام را تعریف کنید' : 'محصولات یا منو را اضافه کنید (قالب‌های آماده هم هست)', href: service ? '/biz/booking' : '/biz/products' },
    { done: b.orders.some((o) => o.status !== 'pending' && o.status !== 'canceled'), label: service ? 'اولین نوبت را «انجام شد» بزنید' : 'اولین فروش را از صندوق ثبت کنید', href: service ? '/biz/booking' : '/biz/pos' },
    { done: !!b.online?.publishedAt, label: 'صفحه آنلاین و ربات تلگرام را برای مشتری‌ها روشن کنید', href: '/biz/online' },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <Card title="شروع کار">
      <ol className="biz-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            {s.done ? '✓ ' : ''}
            {s.done ? s.label : <Link href={s.href}>{s.label}</Link>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Draw({ d, b }: { d: FinanceData; b: Business }) {
  const { update, today } = useFinance();
  const bizAccs = d.accounts.filter((a) => a.bizId === b.id && isMoneyAccount(a));
  const mine = d.accounts.filter((a) => isMoneyAccount(a) && !a.bizId);
  const [from, setFrom] = useState(bizAccs[0]?.id ?? '');
  const [to, setTo] = useState(mine[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="fin-grid">
      <label className="fin-field">
        <span className="fin-label">از حساب کسب‌وکار</span>
        <select className="fin-input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="از حساب کسب‌وکار">
          {bizAccs.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="fin-field">
        <span className="fin-label">به حساب شخصی</span>
        <select className="fin-input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="به حساب شخصی">
          {mine.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <TomanInput label="مبلغ برداشت (تومان)" value={amount} onChange={setAmount} />
      <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsAhead={1} />
      <p className="fin-span muted small">برداشت صاحب کار در درآمد شخصی شما حساب می‌شود («برداشت از کسب‌وکار»)، نه در هزینه مغازه.</p>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let e: string | null = null;
            update((dr) => {
              e = ownerDraw(dr, from, to, tomanToRial(parseAmount(amount) || 0), date);
            });
            setMsg(e ?? 'برداشت ثبت شد ✓');
            if (!e) setAmount('');
          }}
        >
          ثبت برداشت
        </button>
        {msg ? <span className={msg.endsWith('✓') ? 'fin-ok' : 'fin-err'}>{msg}</span> : null}
      </div>
    </div>
  );
}

function Home({ d, b }: { d: FinanceData; b: Business }) {
  const { today, update } = useFinance();
  const now = Date.now();
  const ov = overview(b, today, now);
  const week = dailyProfit(b, addDays(today, -6), today);
  const w = sumRows(week);
  const month = sumRows(dailyProfit(b, addDays(today, -29), today));
  const bal = accountBalances(d);
  const accs = d.accounts.filter((a) => a.bizId === b.id && isMoneyAccount(a));
  const info = typeInfo(b.type);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const max = Math.max(1, ...week.map((r) => r.revenueRial));
  const old = b.orders.filter((o) => (o.saleDate ?? o.date) < addDays(today, -400) && o.status !== 'pending').length;
  return (
    <>
      <dl className="fin-kpis">
        <div className="fin-stat" data-testid="biz-today">
          <dt>فروش امروز</dt>
          <dd>
            <Money rial={ov.today.revenueRial} short />
          </dd>
          <dd className="fin-stat-sub">{fa(ov.today.orders)} فاکتور</dd>
        </div>
        <div className="fin-stat">
          <dt>سود امروز</dt>
          <dd className={ov.today.profitRial >= 0 ? 'up' : 'down'}>
            <Money rial={ov.today.profitRial} short signed />
          </dd>
          <dd className="fin-stat-sub">فروش − بهای تمام‌شده − هزینه‌ها</dd>
        </div>
        <div className="fin-stat">
          <dt>۳۰ روز اخیر</dt>
          <dd>
            <Money rial={month.revenueRial} short />
          </dd>
          <dd className="fin-stat-sub">
            سود <Money rial={month.profitRial} short signed />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>طلب نسیه</dt>
          <dd>
            <Money rial={ov.creditOpenRial} short />
          </dd>
        </div>
      </dl>

      {ov.pendingOrders || ov.lowStock || ov.todayBookings ? (
        <div className="biz-alerts">
          {ov.pendingOrders ? (
            <Link className="banner warn" href="/biz/orders">
              {fa(ov.pendingOrders)} سفارش منتظر تأیید است.
            </Link>
          ) : null}
          {ov.lowStock ? (
            <Link className="banner warn" href="/biz/stock">
              {fa(ov.lowStock)} قلم انبار به نقطه سفارش رسیده.
            </Link>
          ) : null}
          {ov.todayBookings ? (
            <Link className="banner info" href="/biz/booking">
              امروز {fa(ov.todayBookings)} نوبت دارید.
            </Link>
          ) : null}
        </div>
      ) : null}

      <Checklist b={b} />

      <div className="biz-quick">
        {info.kind === 'service' ? (
          <Link className="btn" href="/biz/booking">
            📅 نوبت‌ها
          </Link>
        ) : null}
        <Link className="btn" href="/biz/pos">
          ⚡ فروش سریع
        </Link>
        <Link className="btn ghost" href="/biz/orders">
          🛒 سفارش‌ها
        </Link>
        <Link className="btn ghost" href="/biz/money">
          💰 ثبت هزینه
        </Link>
      </div>

      <Card title="فروش هفت روز اخیر">
        <div className="biz-bars" role="img" aria-label={`فروش هفت روز اخیر: ${fa(Math.round(w.revenueRial / 10))} تومان`}>
          {days.map((day) => {
            const r = week.find((x) => x.day === day);
            return (
              <div key={day} className="biz-bar">
                <b style={{ height: `${((r?.revenueRial ?? 0) / max) * 100}%` }} />
                <small>{new Date(`${day}T12:00:00Z`).toLocaleDateString('fa-IR', { weekday: 'narrow' })}</small>
              </div>
            );
          })}
        </div>
        <p className="small">
          جمع هفته: <Money rial={w.revenueRial} />، سود <Money rial={w.profitRial} signed />.
        </p>
      </Card>

      <Card title="پول کسب‌وکار در دفتر">
        <ul className="fin-list">
          {accs.map((a) => (
            <li key={a.id} className="fin-list-row">
              <span className="fin-list-main">
                <b>{a.name}</b>
                <small>{a.reported ? 'موجودی از پیامک بانک' : 'از فروش و هزینه‌های ثبت‌شده'}</small>
              </span>
              <Money rial={bal[a.id] ?? 0} />
            </li>
          ))}
        </ul>
        <details className="biz-details">
          <summary>برداشت صاحب کار</summary>
          <Draw d={d} b={b} />
        </details>
      </Card>

      {old ? (
        <Card>
          <p className="small">
            {fa(old)} فاکتور قدیمی‌تر از ۴۰۰ روز در حافظه است. برای سبک ماندن اپ، می‌توانید آن‌ها را به یک ردیف در روز خلاصه کنید؛ گزارش‌ها و مالیات تغییری نمی‌کنند.
          </p>
          <button className="fin-mini" onClick={() => update((dr) => void compactBiz(dr.biz!, today))}>
            خلاصه کن
          </button>
        </Card>
      ) : null}
    </>
  );
}

export default function BizHome() {
  return (
    <div className="wrap biz">
      <WithBook>
        {(d) =>
          d.biz ? (
            <>
              <BizTabs b={d.biz} />
              <PageHead title={`${typeInfo(d.biz.type).icon} ${d.biz.name}`}>امروز کسب‌وکار در یک نگاه؛ همه‌چیز فقط روی همین دستگاه است مگر آن‌چه برای مشتری‌ها منتشر کنید.</PageHead>
              <Home d={d} b={d.biz} />
            </>
          ) : (
            <>
              <PageHead title="کسب‌وکار من">مدیریت کامل کسب‌وکار کوچک، کنار دفتر مالی شخصی.</PageHead>
              <Setup d={d} />
            </>
          )
        }
      </WithBook>
    </div>
  );
}
