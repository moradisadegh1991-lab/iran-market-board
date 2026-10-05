'use client';
import { useState } from 'react';
import { newId, tomanToRial, type FinanceData } from '@/lib/finance/model';
import type { Business, Segment } from '@/lib/biz/model';
import { tehranParts } from '@/lib/biz/slots';
import { addCreditCustomer, addCreditPayment, addCreditSale, creditBalance, deleteCreditCustomer, deleteCreditEntry, inSegment } from '@/lib/biz/ops';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtDateFa, fmtToman, Money, parseAmount, TextInput, TomanInput } from '../finance/kit';
import { Chips } from '../ui';
import { BizAccountSelect, fa, firstBizAccount, smsHref, WithBiz } from './kit';

const SEG_LABEL: Record<Segment, string> = { all: 'همه', vip: 'ویژه', returning: 'بازگشتی', inactive: 'غیرفعال (+۳۰ روز)', new: 'تازه‌وارد' };

function Club({ b, seg, setSeg }: { b: Business; seg: Segment; setSeg: (s: Segment) => void }) {
  const now = Date.now();
  const list = b.customers.filter((c) => inSegment(c, seg, now)).sort((a, c) => c.lastAt - a.lastAt);
  return (
    <>
      <Chips label="دسته مشتری" value={seg} onChange={setSeg} options={(Object.keys(SEG_LABEL) as Segment[]).map((k) => ({ key: k, label: SEG_LABEL[k], count: b.customers.filter((c) => inSegment(c, k, now)).length }))} />
      <p className="muted small">مشتری‌ها خودکار از سفارش‌ها و نوبت‌هایی که شماره دارند جمع می‌شوند؛ هر ۱۰٬۰۰۰ تومان خرید یک امتیاز. ویژه: بیش از ۲ میلیون تومان خرید یا ۵ سفارش.</p>
      <ul className="fin-list">
        {list.map((c) => (
          <li key={c.id} className="fin-list-row" data-testid="biz-customer">
            <span className="fin-list-main">
              <b>{c.name ?? c.phone}</b>
              <small>
                <bdi dir="ltr">{c.phone}</bdi>، {fa(c.orders)} سفارش، آخرین {fmtDateFa(tehranParts(c.lastAt).date)}
              </small>
            </span>
            <span className="fin-list-nums">
              <Money rial={c.spentRial} />
              <small>⭐ {fa(c.points)}</small>
            </span>
          </li>
        ))}
        {!list.length ? <li className="empty">در این دسته مشتری‌ای نیست.</li> : null}
      </ul>
    </>
  );
}

function Campaign({ b, seg, setSeg }: { b: Business; seg: Segment; setSeg: (s: Segment) => void }) {
  const { update } = useFinance();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const now = Date.now();
  const to = b.customers.filter((c) => inSegment(c, seg, now));
  // a Persian SMS part holds 70 characters
  const parts = Math.max(1, Math.ceil(text.trim().length / 70));
  return (
    <Card title="پیامک تبلیغاتی">
      <Chips label="گیرنده‌ها" value={seg} onChange={setSeg} options={(Object.keys(SEG_LABEL) as Segment[]).map((k) => ({ key: k, label: SEG_LABEL[k], count: b.customers.filter((c) => inSegment(c, k, now)).length }))} />
      <div className="fin-grid">
        <TextInput label="عنوان (فقط برای خودتان)" value={title} onChange={setTitle} placeholder="مثلاً تخفیف آخر هفته" />
        <label className="fin-field fin-span">
          <span className="fin-label">
            متن پیامک ({fa(text.trim().length)} حرف، {fa(parts)} قطعه)
          </span>
          <textarea className="fin-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="متن پیامک" />
        </label>
      </div>
      <p className="small">
        پیامک از خط خود گوشی شما فرستاده می‌شود: دکمه زیر برنامه پیامک گوشی را با {fa(to.length)} گیرنده و همین متن باز می‌کند و ارسال را خودتان می‌زنید. هزینه را اپراتور خودتان
        حساب می‌کند. برای فهرست‌های بلند، اپراتور ممکن است ارسال انبوه از خط شخصی را محدود کند.
      </p>
      <div className="fin-actions">
        <a
          className={`btn${!to.length || !text.trim() ? ' disabled' : ''}`}
          aria-disabled={!to.length || !text.trim()}
          href={to.length && text.trim() ? smsHref(to.map((c) => c.phone), text.trim()) : undefined}
          onClick={() => {
            if (!to.length || !text.trim()) return;
            update((dr) => void dr.biz!.campaigns.push({ id: newId('m'), at: Date.now(), segment: seg, title: title.trim() || null, text: text.trim(), count: to.length }));
          }}
        >
          باز کردن در پیامک گوشی
        </a>
        <button className="btn ghost" disabled={!to.length} onClick={() => navigator.clipboard?.writeText(to.map((c) => c.phone).join('\n'))}>
          کپی شماره‌ها
        </button>
      </div>
      {b.campaigns.length ? (
        <ul className="fin-list small">
          {[...b.campaigns]
            .reverse()
            .slice(0, 10)
            .map((c) => (
              <li key={c.id} className="fin-list-row">
                <span>
                  {c.title ?? c.text.slice(0, 30)} — {SEG_LABEL[c.segment]}
                </span>
                <span>{fa(c.count)} نفر</span>
              </li>
            ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Debtor({ d, b, id, onBack }: { d: FinanceData; b: Business; id: string; onBack: () => void }) {
  const { update } = useFinance();
  const c = b.credit.find((x) => x.id === id);
  const [mode, setMode] = useState<'sale' | 'payment' | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [acc, setAcc] = useState(firstBizAccount(b));
  const [err, setErr] = useState<string | null>(null);
  if (!c) return null;
  const bal = creditBalance(c);
  return (
    <Card title={c.name} action={<button className="fin-mini ghost" onClick={onBack}>→ فهرست</button>}>
      <p>
        مانده: <b className={bal > 0 ? 'down' : 'up'}>{bal > 0 ? fmtToman(bal) : bal < 0 ? `${fmtToman(-bal)} طلب مشتری` : 'تسویه ✓'}</b>
        {c.phone ? (
          <>
            {' '}
            · <bdi dir="ltr">{c.phone}</bdi>
          </>
        ) : null}
      </p>
      <div className="fin-actions">
        <button className="btn ghost" onClick={() => setMode('sale')}>
          + بدهی تازه
        </button>
        <button className="btn" onClick={() => setMode('payment')}>
          + دریافت پول
        </button>
        {c.phone && bal > 0 ? (
          <a className="btn ghost" href={smsHref([c.phone], `${c.name} عزیز، مانده حساب شما نزد ${b.name}: ${fmtToman(bal)}. سپاس.`)}>
            ✉ یادآوری پیامکی
          </a>
        ) : null}
      </div>
      {mode ? (
        <div className="fin-grid">
          <TomanInput label={mode === 'sale' ? 'مبلغ جنس برده‌شده (تومان)' : 'مبلغ دریافتی (تومان)'} value={amount} onChange={setAmount} />
          <TextInput label="توضیح" value={note} onChange={setNote} />
          {mode === 'payment' ? <BizAccountSelect d={d} b={b} value={acc} onChange={setAcc} label="واریز به" allowNone /> : null}
          <div className="fin-span fin-actions">
            <button
              className="btn"
              onClick={() => {
                let e: string | null = null;
                const rial = tomanToRial(parseAmount(amount) || 0);
                update((dr) => {
                  e = mode === 'sale' ? addCreditSale(dr.biz!, c.id, rial, note || null, Date.now()) : addCreditPayment(dr, c.id, rial, acc || null, note || null, Date.now());
                });
                setErr(e);
                if (!e) {
                  setMode(null);
                  setAmount('');
                  setNote('');
                }
              }}
            >
              ثبت
            </button>
            {err ? <span className="fin-err">{err}</span> : null}
          </div>
        </div>
      ) : null}
      <ul className="fin-list">
        {[...c.entries].reverse().map((e) => (
          <li key={e.id} className="fin-list-row">
            <span className="fin-list-main">
              <span>{e.kind === 'sale' ? 'بدهی' : 'دریافت'}</span>
              <small>
                {fmtDateFa(e.date)}
                {e.note ? `، ${e.note}` : ''}
              </small>
            </span>
            <span className="fin-list-nums">
              <Money rial={e.kind === 'sale' ? e.amountRial : -e.amountRial} signed />
              {!e.orderId ? (
                <button className="fin-mini ghost" onClick={() => window.confirm('این ردیف حذف شود؟') && update((dr) => deleteCreditEntry(dr, c.id, e.id))}>
                  حذف
                </button>
              ) : (
                <small>از فاکتور</small>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button
        className="fin-mini ghost"
        onClick={() => {
          if (!window.confirm(`«${c.name}» و همه ردیف‌هایش حذف شود؟ پول‌هایی که دریافت شده در دفتر می‌ماند.`)) return;
          update((dr) => deleteCreditCustomer(dr, c.id));
          onBack();
        }}
      >
        حذف بدهکار
      </button>
    </Card>
  );
}

function Credit({ d, b }: { d: FinanceData; b: Business }) {
  const { update } = useFinance();
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const total = b.credit.reduce((s, c) => s + Math.max(0, creditBalance(c)), 0);
  if (open) return <Debtor d={d} b={b} id={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <dl className="fin-kpis">
        <div className="fin-stat">
          <dt>جمع طلب نسیه</dt>
          <dd className={total ? 'down' : 'up'} data-testid="credit-total">
            <Money rial={total} short />
          </dd>
        </div>
      </dl>
      <Card>
        <details className="biz-details" open={!b.credit.length}>
          <summary>+ بدهکار تازه</summary>
          <div className="fin-grid">
            <TextInput label="نام" value={name} onChange={setName} placeholder="مثلاً حسن‌آقا" />
            <label className="fin-field">
              <span className="fin-label">موبایل (اختیاری)</span>
              <input className="fin-input" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="موبایل بدهکار" />
            </label>
            <TomanInput label="بدهی اولیه (تومان، اختیاری)" value={amount} onChange={setAmount} />
            <div className="fin-span fin-actions">
              <button
                className="btn"
                disabled={!name.trim()}
                onClick={() => {
                  update((dr) => {
                    const c = addCreditCustomer(dr.biz!, name, phone || null, null, Date.now());
                    const rial = tomanToRial(parseAmount(amount) || 0);
                    if (rial > 0) addCreditSale(dr.biz!, c.id, rial, 'بدهی اولیه', Date.now());
                  });
                  setName('');
                  setPhone('');
                  setAmount('');
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        </details>
      </Card>
      <ul className="fin-list">
        {[...b.credit]
          .sort((a, c) => creditBalance(c) - creditBalance(a))
          .map((c) => {
            const bal = creditBalance(c);
            return (
              <li key={c.id} className="fin-list-row">
                <button className="fin-list-main linklike-row" onClick={() => setOpen(c.id)}>
                  <b>{c.name}</b>
                  <small>{fa(c.entries.length)} ردیف</small>
                </button>
                <b className={bal > 0 ? 'down' : 'up'}>{bal > 0 ? <Money rial={bal} /> : 'تسویه ✓'}</b>
              </li>
            );
          })}
      </ul>
      <p className="muted small">فروش نسیه پولی جابه‌جا نمی‌کند؛ وقتی پول را گرفتید «دریافت پول» بزنید تا در صندوق یا کارت مغازه ثبت شود.</p>
    </>
  );
}

function Customers({ d, b }: { d: FinanceData; b: Business }) {
  const [tab, setTab] = useState<'club' | 'credit' | 'sms'>('club');
  const [seg, setSeg] = useState<Segment>('all');
  return (
    <>
      <Chips
        label="بخش"
        value={tab}
        onChange={setTab}
        options={[
          { key: 'club', label: 'باشگاه مشتریان', count: b.customers.length },
          { key: 'credit', label: 'دفتر نسیه', count: b.credit.length },
          { key: 'sms', label: 'کمپین پیامکی' },
        ]}
      />
      {tab === 'club' ? <Club b={b} seg={seg} setSeg={setSeg} /> : tab === 'credit' ? <Credit d={d} b={b} /> : <Campaign b={b} seg={seg} setSeg={setSeg} />}
    </>
  );
}

export default function CustomersView() {
  return <WithBiz title="مشتری‌ها و نسیه" lede="باشگاه مشتریان با امتیاز وفاداری، دفتر نسیه که گم نمی‌شود، و پیامک هدفمند برای برگرداندن مشتری.">{(d, b) => <Customers d={d} b={b} />}</WithBiz>;
}
