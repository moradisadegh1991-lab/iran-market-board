'use client';
import { useMemo, useRef, useState } from 'react';
import { rialToTomanN, tomanToRial } from '@/lib/finance/model';
import type { Business, Product } from '@/lib/biz/model';
import { addIngredient, addProduct, applyTemplate, editProduct, importProducts, productCost, removeProduct, renameCategory, setBomLine } from '@/lib/biz/ops';
import { templatesFor } from '@/lib/biz/templates';
import { newId } from '@/lib/finance/model';
import { useFinance } from '../finance/FinanceProvider';
import { Card, confirmDelete, fmtDateFa, fmtPctFa, JalaliDate, Money, NumInput, parseAmount, TextInput, TomanInput } from '../finance/kit';
import { Chips } from '../ui';
import { downloadText, fa, WithBiz } from './kit';

type Tab = 'list' | 'templates' | 'discounts' | 'excel';

function AddProduct({ b }: { b: Business }) {
  const { update } = useFinance();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cat, setCat] = useState('');
  const [prep, setPrep] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cats = [...new Set(b.products.map((p) => p.category?.trim()).filter(Boolean))] as string[];
  return (
    <div className="fin-grid">
      <TextInput label="نام محصول" value={name} onChange={setName} placeholder="مثلاً لاته" />
      <TomanInput label="قیمت فروش (تومان)" value={price} onChange={setPrice} />
      <label className="fin-field">
        <span className="fin-label">دسته</span>
        <input className="fin-input" list="biz-cats" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="دسته" />
        <datalist id="biz-cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <NumInput label="زمان آماده‌سازی (دقیقه)" value={prep} onChange={setPrep} hint="با نرخ ساعتی کارگاه، دستمزد هر عدد را می‌سازد" />
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: Product | string = '';
            update((dr) => {
              r = addProduct(dr.biz!, { name, priceRial: tomanToRial(parseAmount(price) || 0), category: cat, prepMin: parseAmount(prep) || 0 }, Date.now());
            });
            if (typeof r === 'string') setErr(r);
            else {
              setName('');
              setPrice('');
              setErr(null);
            }
          }}
        >
          افزودن محصول
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </div>
  );
}

function Recipe({ b, p }: { b: Business; p: Product }) {
  const { update } = useFinance();
  const [ing, setIng] = useState('');
  const [qty, setQty] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('عدد');
  const byId = new Map(b.ingredients.map((i) => [i.id, i]));
  return (
    <div className="biz-recipe">
      <b className="small">فرمول ساخت (BOM) — برای یک عدد</b>
      <ul className="fin-list">
        {p.bom.map((l) => {
          const i = byId.get(l.ingredientId);
          return (
            <li key={l.ingredientId} className="fin-list-row">
              <span className="fin-list-main">
                <span>
                  {i?.name ?? '؟'}: {fa(l.qty, 3)} {i?.unit}
                </span>
                <small>
                  <Money rial={l.qty * (i?.unitCostRial ?? 0)} />
                </small>
              </span>
              <button className="fin-mini ghost" onClick={() => update((dr) => void setBomLine(dr.biz!, p.id, l.ingredientId, 0))} aria-label={`حذف ${i?.name} از فرمول`}>
                حذف
              </button>
            </li>
          );
        })}
      </ul>
      <div className="biz-inline">
        <select className="fin-input sm" value={ing} onChange={(e) => setIng(e.target.value)} aria-label="ماده اولیه">
          <option value="">ماده اولیه…</option>
          {b.ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
          <option value="__new">+ ماده تازه…</option>
        </select>
        {ing === '__new' ? (
          <>
            <input className="fin-input sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="نام ماده" aria-label="نام ماده تازه" />
            <input className="fin-input sm" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="واحد" aria-label="واحد ماده تازه" />
          </>
        ) : null}
        <input className="fin-input sm" dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="مقدار" aria-label="مقدار در فرمول" />
        <button
          className="fin-mini"
          onClick={() => {
            const n = parseAmount(qty);
            if (!(n > 0) || !ing) return;
            update((dr) => {
              let id = ing;
              if (ing === '__new') {
                const r = addIngredient(dr.biz!, { name: newName, unit: newUnit }, Date.now());
                if (typeof r === 'string') return;
                id = r.id;
              }
              setBomLine(dr.biz!, p.id, id, n);
            });
            setQty('');
            setIng('');
            setNewName('');
          }}
        >
          افزودن به فرمول
        </button>
      </div>
    </div>
  );
}

function ProductRow({ b, p }: { b: Business; p: Product }) {
  const { update } = useFinance();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(String(rialToTomanN(p.priceRial)));
  const [cat, setCat] = useState(p.category ?? '');
  const [prep, setPrep] = useState(String(p.prepMin));
  const [desc, setDesc] = useState(p.description ?? '');
  const [img, setImg] = useState(p.imageUrl ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const c = productCost(b, p);
  return (
    <li className={`fin-list-block${p.active ? '' : ' archived'}`} data-testid="biz-product">
      <div className="fin-list-row">
        <button className="fin-list-main linklike-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <b>
            {p.name}
            {p.active ? '' : ' (بایگانی)'}
          </b>
          <small>
            بهای تمام‌شده <Money rial={c.unitRial} />
            {c.marginPct !== null ? `، حاشیه ${fmtPctFa(c.marginPct)}` : ''}
            {!p.bom.length ? '، بی‌فرمول' : ''}
          </small>
        </button>
        <span className="fin-list-nums">
          <Money rial={p.priceRial} />
          <small className={c.marginRial < 0 ? 'down' : 'up'}>
            سود <Money rial={c.marginRial} />
          </small>
        </span>
      </div>
      {open ? (
        <div className="fin-form">
          <div className="fin-grid">
            <TextInput label="نام" value={name} onChange={setName} />
            <TomanInput label="قیمت فروش (تومان)" value={price} onChange={setPrice} />
            <TextInput label="دسته" value={cat} onChange={setCat} />
            <NumInput label="زمان آماده‌سازی (دقیقه)" value={prep} onChange={setPrep} />
            <TextInput label="توضیح برای منوی آنلاین" value={desc} onChange={setDesc} />
            <TextInput label="آدرس عکس (اختیاری)" value={img} onChange={setImg} placeholder="https://…" />
          </div>
          <p className="muted small">
            مواد <Money rial={c.materialRial} /> + دستمزد <Money rial={c.laborRial} /> = <Money rial={c.unitRial} />
          </p>
          <div className="fin-actions">
            <button
              className="fin-mini"
              onClick={() => {
                let e: string | null = null;
                update((dr) => {
                  e = editProduct(dr.biz!, p.id, { name, priceRial: tomanToRial(parseAmount(price) || 0), category: cat, prepMin: parseAmount(prep) || 0, description: desc || null, imageUrl: img || null });
                });
                setMsg(e ?? 'ذخیره شد ✓');
              }}
            >
              ذخیره
            </button>
            {p.active ? (
              <button
                className="fin-mini ghost"
                onClick={() => {
                  if (!window.confirm(`«${p.name}» حذف شود؟ اگر قبلاً فروخته شده، بایگانی می‌شود تا فاکتورهای قبلی سالم بمانند.`)) return;
                  let r: string | null = null;
                  update((dr) => {
                    r = removeProduct(dr.biz!, p.id);
                  });
                  setMsg(r === 'archived' ? 'قبلاً فروخته شده بود؛ بایگانی شد.' : null);
                }}
              >
                حذف
              </button>
            ) : (
              <button className="fin-mini" onClick={() => update((dr) => void (dr.biz!.products.find((x) => x.id === p.id)!.active = true))}>
                برگرداندن به فروش
              </button>
            )}
            {msg ? <span className={msg.endsWith('✓') ? 'fin-ok' : 'small'}>{msg}</span> : null}
          </div>
          <Recipe b={b} p={p} />
        </div>
      ) : null}
    </li>
  );
}

function List({ b }: { b: Business }) {
  const { update } = useFinance();
  const [archived, setArchived] = useState(false);
  const [rate, setRate] = useState(String(rialToTomanN(b.hourlyRial)));
  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of b.products) {
      if (!archived && !p.active) continue;
      const k = p.category?.trim() || 'بدون دسته';
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()];
  }, [b.products, archived]);
  return (
    <>
      <Card>
        <details className="biz-details" open={!b.products.length}>
          <summary>+ محصول تازه</summary>
          <AddProduct b={b} />
        </details>
      </Card>
      {groups.map(([cat, ps]) => (
        <Card
          key={cat}
          title={cat}
          action={
            cat !== 'بدون دسته' ? (
              <button
                className="fin-mini ghost"
                onClick={() => {
                  const to = window.prompt(`نام تازه دسته «${cat}»:`, cat);
                  if (to) update((dr) => renameCategory(dr.biz!, cat, to));
                }}
              >
                تغییر نام
              </button>
            ) : undefined
          }
        >
          <ul className="fin-list">
            {ps.map((p) => (
              <ProductRow key={p.id} b={b} p={p} />
            ))}
          </ul>
        </Card>
      ))}
      {b.products.some((p) => !p.active) ? (
        <label className="biz-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> نمایش بایگانی‌شده‌ها
        </label>
      ) : null}
      <Card title="نرخ ساعتی کارگاه">
        <p className="small">دستمزد هر محصول = نرخ ساعتی × دقیقه آماده‌سازی ÷ ۶۰. صفر یعنی بهای تمام‌شده فقط مواد است.</p>
        <div className="biz-inline">
          <input className="fin-input sm" dir="ltr" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="نرخ ساعتی (تومان)" />
          <span className="small">تومان در ساعت</span>
          <button className="fin-mini" onClick={() => update((dr) => void (dr.biz!.hourlyRial = tomanToRial(parseAmount(rate) || 0)))}>
            ذخیره
          </button>
        </div>
      </Card>
    </>
  );
}

function Templates({ b }: { b: Business }) {
  const { update } = useFinance();
  const all = templatesFor(b.type);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const cats = [...new Set(all.map((t) => t.category))];
  const shown = all.filter((t) => (!cat || t.category === cat) && (!q.trim() || t.productName.includes(q.trim()) || t.ingredients.some((i) => i.name.includes(q.trim()))));
  if (!all.length) return <p className="empty">برای این نوع کسب‌وکار قالب آماده‌ای نیست؛ محصولات را دستی اضافه کنید.</p>;
  return (
    <Card title={`${fa(all.length)} قالب آماده`}>
      <p className="small">هر قالب محصول، مواد اولیه‌ای که ندارید و فرمول ساختش را با یک دکمه می‌سازد. قیمت و مقدارها نقطه شروع‌اند؛ بعد با قیمت خرید خودتان تنظیم کنید.</p>
      <input className="fin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در قالب‌ها…" aria-label="جستجو در قالب‌ها" />
      <div className="chips" role="radiogroup" aria-label="دسته قالب">
        {['', ...cats].map((c) => (
          <button key={c} role="radio" aria-checked={cat === c} onClick={() => setCat(c)}>
            {c || 'همه'}
          </button>
        ))}
      </div>
      <ul className="fin-list">
        {shown.map((t) => {
          const have = done.includes(t.key) || b.products.some((p) => p.name === t.productName);
          return (
            <li key={t.key} className="fin-list-row">
              <span className="fin-list-main">
                <b>
                  {t.icon} {t.productName}
                </b>
                <small>{t.ingredients.map((i) => i.name).join('، ')}</small>
              </span>
              <span className="fin-list-nums">
                <Money rial={tomanToRial(t.suggestedPrice)} />
                <button
                  className="fin-mini"
                  disabled={have}
                  onClick={() => {
                    update((dr) => void applyTemplate(dr.biz!, t, Date.now()));
                    setDone((x) => [...x, t.key]);
                  }}
                >
                  {have ? 'اضافه شد' : 'افزودن'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Discounts({ b }: { b: Business }) {
  const { update, today } = useFinance();
  const [title, setTitle] = useState('');
  const [pct, setPct] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Card title="تخفیف تازه">
        <div className="fin-grid">
          <TextInput label="عنوان" value={title} onChange={setTitle} placeholder="مثلاً تخفیف آخر هفته" />
          <NumInput label="درصد" value={pct} onChange={setPct} />
          <JalaliDate label="از" value={from} onChange={setFrom} yearsAhead={1} yearsBack={0} />
          <JalaliDate label="تا" value={to} onChange={setTo} yearsAhead={1} yearsBack={0} />
          <div className="fin-span fin-actions">
            <button
              className="btn"
              onClick={() => {
                const p = parseAmount(pct);
                if (!title.trim() || !(p > 0 && p <= 100)) return setErr('عنوان و درصد (۱ تا ۱۰۰) را درست بنویسید.');
                if (to < from) return setErr('تاریخ پایان قبل از شروع است.');
                update((dr) => void dr.biz!.discounts.push({ id: newId('d'), title: title.trim(), pct: p, from, to, active: true }));
                setTitle('');
                setPct('');
                setErr(null);
              }}
            >
              افزودن تخفیف
            </button>
            {err ? <span className="fin-err">{err}</span> : null}
          </div>
        </div>
        <p className="muted small">تخفیف فعال در صندوق فروش قابل انتخاب است و بهترینِ آن روی منوی آنلاین هم نشان داده می‌شود.</p>
      </Card>
      <ul className="fin-list">
        {[...b.discounts].reverse().map((x) => (
          <li key={x.id} className="fin-list-row">
            <span className="fin-list-main">
              <b>
                {x.title} ({fa(x.pct)}٪)
              </b>
              <small>
                {fmtDateFa(x.from)} تا {fmtDateFa(x.to)}
                {x.to < today ? '، تمام شده' : x.from > today ? '، شروع نشده' : x.active ? '، فعال' : '، خاموش'}
              </small>
            </span>
            <span className="fin-actions">
              <button className="fin-mini" onClick={() => update((dr) => void (dr.biz!.discounts.find((y) => y.id === x.id)!.active = !x.active))}>
                {x.active ? 'خاموش' : 'روشن'}
              </button>
              <button className="fin-mini ghost" onClick={() => confirmDelete(`تخفیف «${x.title}»`) && update((dr) => void (dr.biz!.discounts = dr.biz!.discounts.filter((y) => y.id !== x.id)))}>
                حذف
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const csvCell = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`);

function Excel({ b }: { b: Business }) {
  const { update } = useFinance();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const exportCsv = () => {
    const rows = [['نام', 'دسته', 'قیمت فروش', 'زمان آماده‌سازی (دقیقه)', 'بهای تمام‌شده', 'سود']];
    for (const p of b.products.filter((x) => x.active)) {
      const c = productCost(b, p);
      rows.push([p.name, p.category ?? '', String(rialToTomanN(p.priceRial)), String(p.prepMin), String(Math.round(rialToTomanN(c.unitRial))), String(Math.round(rialToTomanN(c.marginRial)))]);
    }
    downloadText('products.csv', '﻿' + rows.map((r) => r.map((v, i) => (i >= 2 ? csvCell(Number(v)) : csvCell(v))).join(',')).join('\n'));
  };
  const template = () => downloadText('products-template.csv', '﻿' + ['نام,دسته,قیمت فروش,زمان آماده‌سازی (دقیقه)', '"اسپرسو","نوشیدنی گرم",45000,3'].join('\n'));
  return (
    <Card title="ورود و خروج با اکسل">
      <p className="small">ستون‌ها: نام، دسته، قیمت فروش (تومان)، زمان آماده‌سازی (دقیقه). محصول هم‌نام به‌روز می‌شود، تازه‌ها اضافه می‌شوند. فایل فقط در همین دستگاه خوانده می‌شود.</p>
      <div className="fin-actions">
        <button className="btn ghost" onClick={template}>
          فایل نمونه
        </button>
        <button className="btn ghost" onClick={exportCsv}>
          خروجی محصولات
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          ورود از اکسل/CSV
        </button>
        <input
          ref={file}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const XLSX = await import('xlsx');
              const wb = XLSX.read(await f.arrayBuffer());
              const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
              let r = { created: 0, updated: 0, failed: 0, skipped: 0 };
              update((dr) => {
                r = importProducts(dr.biz!, rows, Date.now());
              });
              setMsg(`${fa(r.created)} محصول تازه، ${fa(r.updated)} به‌روز${r.failed ? `، ${fa(r.failed)} ردیف با قیمت نامعتبر رد شد` : ''}${r.skipped ? `، ${fa(r.skipped)} ردیف بی‌نام` : ''}. فرمول ساخت هرکدام را تنظیم کنید.`);
            } catch {
              setMsg('فایل خوانده نشد؛ قالبش را با فایل نمونه مقایسه کنید.');
            }
            e.target.value = '';
          }}
        />
      </div>
      {msg ? <p className="small">{msg}</p> : null}
    </Card>
  );
}

function Products({ b }: { b: Business }) {
  const [tab, setTab] = useState<Tab>('list');
  return (
    <>
      <Chips
        label="بخش"
        value={tab}
        onChange={setTab}
        options={[
          { key: 'list', label: 'محصولات', count: b.products.filter((p) => p.active).length },
          { key: 'templates', label: 'قالب‌های آماده' },
          { key: 'discounts', label: 'تخفیف‌ها', count: b.discounts.length },
          { key: 'excel', label: 'اکسل' },
        ]}
      />
      {tab === 'list' ? <List b={b} /> : tab === 'templates' ? <Templates b={b} /> : tab === 'discounts' ? <Discounts b={b} /> : <Excel b={b} />}
    </>
  );
}

export default function ProductsView() {
  return <WithBiz title="محصولات و منو" lede="قیمت، فرمول ساخت (BOM) و بهای تمام‌شده هر محصول — با هر فروش، مواد اولیه خودکار از انبار کم می‌شود.">{(_d, b) => <Products b={b} />}</WithBiz>;
}
