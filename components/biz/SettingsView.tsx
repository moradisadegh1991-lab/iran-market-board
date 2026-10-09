'use client';
import { useState } from 'react';
import { detachBusinessAccounts } from '@/lib/finance/lending';
import { isMoneyAccount, newId, type FinanceData } from '@/lib/finance/model';
import { BUSINESS_TYPES, type Business, type BusinessType } from '@/lib/biz/model';
import { citiesFor, PROVINCE_NAMES } from '@/lib/biz/locations';
import { useFinance } from '../finance/FinanceProvider';
import { Card, NumInput, parseAmount, TextInput } from '../finance/kit';
import { WithBiz } from './kit';

function Settings({ d, b }: { d: FinanceData; b: Business }) {
  const { update, today } = useFinance();
  const [name, setName] = useState(b.name);
  const [type, setType] = useState<BusinessType>(b.type);
  const [phone, setPhone] = useState(b.phone ?? '');
  const [address, setAddress] = useState(b.address ?? '');
  const [province, setProvince] = useState(b.province ?? '');
  const [city, setCity] = useState(b.city ?? '');
  const [vat, setVat] = useState(String(b.vatPct));
  const [msg, setMsg] = useState<string | null>(null);
  const money = d.accounts.filter(isMoneyAccount);
  const setAccount = (which: 'cashAccountId' | 'cardAccountId', id: string) =>
    update((dr) => {
      const biz = dr.biz!;
      if (id === '__new') {
        const a = { id: newId('a'), name: which === 'cashAccountId' ? `صندوق ${biz.name}` : `کارت ${biz.name}`, kind: which === 'cashAccountId' ? ('cash' as const) : ('bank' as const), openingRial: 0, openedOn: today, bizId: biz.id };
        dr.accounts.push(a);
        biz[which] = a.id;
      } else {
        biz[which] = id || null;
        const a = dr.accounts.find((x) => x.id === id);
        if (a) a.bizId = biz.id;
      }
    });
  return (
    <>
      <Card title="مشخصات">
        <div className="fin-grid">
          <TextInput label="نام کسب‌وکار" value={name} onChange={setName} />
          <label className="fin-field">
            <span className="fin-label">نوع</span>
            <select className="fin-input" value={type} onChange={(e) => setType(e.target.value as BusinessType)} aria-label="نوع کسب‌وکار">
              {BUSINESS_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.icon} {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fin-field">
            <span className="fin-label">تلفن</span>
            <input className="fin-input" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="تلفن کسب‌وکار" />
          </label>
          <TextInput label="آدرس" value={address} onChange={setAddress} />
          <label className="fin-field">
            <span className="fin-label">استان</span>
            <select
              className="fin-input"
              value={province}
              onChange={(e) => {
                setProvince(e.target.value);
                setCity('');
              }}
              aria-label="استان"
            >
              <option value="">—</option>
              {PROVINCE_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="fin-field">
            <span className="fin-label">شهر</span>
            <select className="fin-input" value={city} onChange={(e) => setCity(e.target.value)} aria-label="شهر" disabled={!province}>
              <option value="">—</option>
              {citiesFor(province).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <NumInput label="مالیات بر ارزش افزوده (٪)" value={vat} onChange={setVat} hint="صفر = خاموش؛ اگر مشمول هستید نرخ سال جاری را بنویسید" />
          <div className="fin-span fin-actions">
            <button
              className="btn"
              onClick={() => {
                if (!name.trim()) return setMsg('نام خالی است.');
                const v = parseAmount(vat);
                update((dr) => {
                  Object.assign(dr.biz!, { name: name.trim(), type, phone: phone.trim() || null, address: address.trim() || null, province: province || null, city: city || null, vatPct: v >= 0 && v <= 100 ? v : 0 });
                });
                setMsg('ذخیره شد ✓');
              }}
            >
              ذخیره
            </button>
            {msg ? <span className={msg.endsWith('✓') ? 'fin-ok' : 'fin-err'}>{msg}</span> : null}
          </div>
        </div>
        <p className="muted small">استان، شهر، آدرس و تلفن فقط وقتی «فروشگاه آنلاین» را منتشر کنید روی صفحه مشتری و ربات می‌آیند.</p>
      </Card>
      <Card title="حساب‌های کسب‌وکار در دفتر">
        <p className="small">
          پول نقد صندوق و پرداخت‌های کارتی این‌جا ثبت می‌شوند. حساب‌های کسب‌وکار در دارایی خالص شما هستند ولی تراکنش‌هایشان در درآمد و خرج شخصی حساب نمی‌شوند.
        </p>
        <div className="fin-grid">
          {(['cashAccountId', 'cardAccountId'] as const).map((w) => (
            <label key={w} className="fin-field">
              <span className="fin-label">{w === 'cashAccountId' ? 'فروش نقدی به' : 'فروش کارتی به'}</span>
              <select className="fin-input" value={b[w] ?? ''} onChange={(e) => setAccount(w, e.target.value)} aria-label={w === 'cashAccountId' ? 'حساب فروش نقدی' : 'حساب فروش کارتی'}>
                {w === 'cardAccountId' ? <option value="">همان صندوق نقد</option> : null}
                {money.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.bizId ? '' : ' (شخصی — حساب کسب‌وکار می‌شود)'}
                  </option>
                ))}
                <option value="__new">+ حساب تازه</option>
              </select>
            </label>
          ))}
        </div>
      </Card>
      <Card title="حذف کسب‌وکار">
        <p className="small">محصولات، سفارش‌ها، مشتری‌ها و نوبت‌ها پاک می‌شوند. تراکنش‌هایی که در دفتر ساخته شده و حساب‌ها می‌مانند (حساب‌ها دیگر حساب کسب‌وکار نیستند). اول از «حساب‌ها و کارت‌ها» پشتیبان بگیرید.</p>
        <button
          className="fin-mini ghost"
          onClick={() => {
            if (window.prompt(`برای حذف، نام کسب‌وکار («${b.name}») را بنویسید:`) !== b.name) return;
            update((dr) => {
              if (dr.biz) detachBusinessAccounts(dr, dr.biz.id);
              dr.biz = null;
            });
          }}
        >
          حذف کسب‌وکار
        </button>
      </Card>
    </>
  );
}

export default function SettingsView() {
  return <WithBiz title="تنظیمات کسب‌وکار" lede="مشخصات، ارزش افزوده و این‌که پول فروش در کدام حساب‌های دفتر بنشیند.">{(d, b) => <Settings d={d} b={b} />}</WithBiz>;
}
