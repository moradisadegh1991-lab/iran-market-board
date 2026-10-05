'use client';
import { useState } from 'react';
import { rialToTomanN, tomanToRial, type FinanceData } from '@/lib/finance/model';
import type { Business, Ingredient, InvTxType } from '@/lib/biz/model';
import { addIngredient, addPurchase, addWaste, editIngredient, removeIngredient } from '@/lib/biz/ops';
import { stockOutlook } from '@/lib/biz/reports';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtDateFa, JalaliDate, Money, NumInput, parseAmount, TextInput, TomanInput } from '../finance/kit';
import { BizAccountSelect, downloadText, fa, firstBizAccount, WithBiz } from './kit';

const TX_LABEL: Record<InvTxType, string> = { purchase: 'خرید', consumption: 'مصرف فروش', adjustment: 'اصلاح شمارش', waste: 'ضایعات', return: 'برگشت لغو' };

function Purchase({ d, b }: { d: FinanceData; b: Business }) {
  const { update, today } = useFinance();
  const [ing, setIng] = useState(b.ingredients[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [acc, setAcc] = useState(firstBizAccount(b));
  const [date, setDate] = useState(today);
  const [msg, setMsg] = useState<string | null>(null);
  const unit = b.ingredients.find((i) => i.id === ing)?.unit ?? '';
  return (
    <div className="fin-grid">
      <label className="fin-field">
        <span className="fin-label">ماده</span>
        <select className="fin-input" value={ing} onChange={(e) => setIng(e.target.value)} aria-label="ماده خریداری‌شده">
          {b.ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <NumInput label={`مقدار (${unit})`} value={qty} onChange={setQty} />
      <TomanInput label={`قیمت هر ${unit || 'واحد'} (تومان)`} value={cost} onChange={setCost} />
      <BizAccountSelect d={d} b={b} value={acc} onChange={setAcc} label="پرداخت از" allowNone />
      <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsAhead={0} />
      <p className="fin-span muted small">قیمت واحد با میانگین موزون خرید قبلی ترکیب می‌شود؛ بهای تمام‌شده محصولات هم خودکار به‌روز می‌شود. اگر حساب را انتخاب کنید، هزینه‌اش در دفتر ثبت می‌شود.</p>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let e: string | null = null;
            update((dr) => {
              e = addPurchase(dr, { ingredientId: ing, qty: parseAmount(qty), unitCostRial: tomanToRial(parseAmount(cost)), accountId: acc || null, date }, Date.now());
            });
            setMsg(e ?? 'خرید ثبت شد ✓');
            if (!e) {
              setQty('');
              setCost('');
            }
          }}
        >
          ثبت خرید
        </button>
        {msg ? <span className={msg.endsWith('✓') ? 'fin-ok' : 'fin-err'}>{msg}</span> : null}
      </div>
    </div>
  );
}

function Row({ b, ing, perDay, daysLeft }: { b: Business; ing: Ingredient; perDay: number; daysLeft: number | null }) {
  const { update } = useFinance();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(ing.name);
  const [unit, setUnit] = useState(ing.unit);
  const [reorder, setReorder] = useState(String(ing.reorder));
  const [stock, setStock] = useState(String(+ing.stock.toFixed(3)));
  const [cost, setCost] = useState(String(rialToTomanN(ing.unitCostRial)));
  const [waste, setWaste] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const low = ing.stock <= ing.reorder;
  return (
    <li className={`fin-list-block${low ? ' biz-low' : ''}`} data-testid="biz-ingredient">
      <div className="fin-list-row">
        <button className="fin-list-main linklike-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <b>
            {ing.name}
            {low ? ' ⚠️' : ''}
          </b>
          <small>
            {daysLeft !== null ? `مصرف روزانه ${fa(perDay, 2)} ${ing.unit}، حدود ${fa(daysLeft)} روز دیگر` : 'در ۳۰ روز اخیر مصرف نشده'}، نقطه سفارش {fa(ing.reorder, 3)}
          </small>
        </button>
        <span className="fin-list-nums">
          <b className={low ? 'down' : ''}>
            {fa(ing.stock, 3)} {ing.unit}
          </b>
          <small>
            هر {ing.unit} <Money rial={ing.unitCostRial} />
          </small>
        </span>
      </div>
      {open ? (
        <div className="fin-form">
          <div className="fin-grid">
            <TextInput label="نام" value={name} onChange={setName} />
            <TextInput label="واحد" value={unit} onChange={setUnit} />
            <NumInput label="نقطه سفارش" value={reorder} onChange={setReorder} />
            <NumInput label="موجودی شمرده‌شده" value={stock} onChange={setStock} hint="اختلاف به‌عنوان «اصلاح شمارش» ثبت می‌شود" />
            <TomanInput label="قیمت هر واحد (تومان)" value={cost} onChange={setCost} />
          </div>
          <div className="fin-actions">
            <button
              className="fin-mini"
              onClick={() => {
                let e: string | null = null;
                update((dr) => {
                  e = editIngredient(dr.biz!, ing.id, { name, unit, reorder: parseAmount(reorder) || 0, stock: parseAmount(stock), unitCostRial: tomanToRial(parseAmount(cost) || 0) }, Date.now());
                });
                setMsg(e ?? 'ذخیره شد ✓');
              }}
            >
              ذخیره
            </button>
            <input className="fin-input sm" dir="ltr" inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} placeholder="مقدار" aria-label={`ضایعات ${ing.name}`} />
            <button
              className="fin-mini ghost"
              onClick={() => {
                let e: string | null = null;
                update((dr) => {
                  e = addWaste(dr.biz!, ing.id, parseAmount(waste), 'ضایعات', Date.now());
                });
                setMsg(e ?? 'ضایعات ثبت شد ✓');
                if (!e) setWaste('');
              }}
            >
              ثبت ضایعات
            </button>
            <button
              className="fin-mini ghost"
              onClick={() => {
                const used = b.products.filter((p) => p.bom.some((l) => l.ingredientId === ing.id)).map((p) => p.name);
                if (!window.confirm(used.length ? `«${ing.name}» در فرمول ${used.join('، ')} است و از آن‌ها هم پاک می‌شود. حذف شود؟` : `«${ing.name}» حذف شود؟`)) return;
                update((dr) => void removeIngredient(dr.biz!, ing.id));
              }}
            >
              حذف
            </button>
            {msg ? <span className={msg.endsWith('✓') ? 'fin-ok' : 'fin-err'}>{msg}</span> : null}
          </div>
          <ul className="fin-list small">
            {b.invTx
              .filter((t) => t.ingredientId === ing.id)
              .slice(-8)
              .reverse()
              .map((t) => (
                <li key={t.id} className="fin-list-row">
                  <span>
                    {fmtDateFa(t.date)}، {TX_LABEL[t.type]}
                    {t.note && t.type !== 'waste' ? `، ${t.note}` : ''}
                  </span>
                  <b className={t.qty < 0 ? 'down' : 'up'}>
                    {t.qty > 0 ? '+' : '−'}
                    {fa(Math.abs(t.qty), 3)}
                  </b>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function Stock({ d, b }: { d: FinanceData; b: Business }) {
  const { update, today } = useFinance();
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('عدد');
  const [reorder, setReorder] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const outlook = stockOutlook(b, today).filter((o) => o.ingredient.name.includes(q.trim()));
  const value = b.ingredients.reduce((s, i) => s + Math.max(0, i.stock) * i.unitCostRial, 0);
  const low = b.ingredients.filter((i) => i.stock <= i.reorder);
  return (
    <>
      <dl className="fin-kpis">
        <div className="fin-stat">
          <dt>ارزش انبار</dt>
          <dd>
            <Money rial={value} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>رسیده به نقطه سفارش</dt>
          <dd className={low.length ? 'down' : 'up'}>{fa(low.length)} قلم</dd>
        </div>
      </dl>
      {low.length ? <p className="banner warn">باید سفارش داد: {low.map((i) => i.name).join('، ')}</p> : null}
      <Card>
        <details className="biz-details">
          <summary>+ ثبت خرید</summary>
          {b.ingredients.length ? <Purchase d={d} b={b} /> : <p className="small">اول یک ماده اولیه اضافه کنید.</p>}
        </details>
        <details className="biz-details" open={!b.ingredients.length}>
          <summary>+ ماده اولیه یا کالای تازه</summary>
          <div className="fin-grid">
            <TextInput label="نام ماده" value={name} onChange={setName} placeholder="مثلاً شیر" />
            <TextInput label="واحد" value={unit} onChange={setUnit} placeholder="عدد، kg، لیتر" />
            <NumInput label="نقطه سفارش" value={reorder} onChange={setReorder} hint="به این مقدار که رسید، هشدار می‌دهد" />
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  let r: Ingredient | string = '';
                  update((dr) => {
                    r = addIngredient(dr.biz!, { name, unit, reorder: parseAmount(reorder) || 0 }, Date.now());
                  });
                  if (typeof r === 'string') setErr(r);
                  else {
                    setName('');
                    setReorder('');
                    setErr(null);
                  }
                }}
              >
                افزودن
              </button>
              {err ? <span className="fin-err">{err}</span> : null}
            </div>
          </div>
        </details>
      </Card>
      <input className="fin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در انبار…" aria-label="جستجو در انبار" />
      <ul className="fin-list">
        {outlook.map((o) => (
          <Row key={o.ingredient.id} b={b} ing={o.ingredient} perDay={o.perDay} daysLeft={o.daysLeft} />
        ))}
        {!outlook.length ? <li className="empty">انبار خالی است.</li> : null}
      </ul>
      {b.ingredients.length ? (
        <button
          className="fin-mini ghost"
          onClick={() =>
            downloadText(
              'stock.csv',
              '﻿' + ['نام,واحد,موجودی,نقطه سفارش,قیمت واحد (تومان)', ...b.ingredients.map((i) => `"${i.name.replace(/"/g, '""')}","${i.unit}",${+i.stock.toFixed(3)},${i.reorder},${Math.round(rialToTomanN(i.unitCostRial))}`)].join('\n'),
            )
          }
        >
          خروجی اکسل انبار
        </button>
      ) : null}
      <p className="muted small">«روز دیگر» فقط تقسیم موجودی بر میانگین مصرف ۳۰ روز اخیر است، نه پیش‌بینی؛ فصل، تعطیلی و تبلیغ آن را عوض می‌کنند.</p>
    </>
  );
}

export default function StockView() {
  return <WithBiz title="انبار" lede="موجودی مواد و کالا، خرید با میانگین قیمت، ضایعات و هشدار نقطه سفارش. هر فروش طبق فرمول محصول از انبار کم می‌کند.">{(d, b) => <Stock d={d} b={b} />}</WithBiz>;
}
