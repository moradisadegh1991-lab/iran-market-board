'use client';
// The pieces of an asset the «سرمایه‌ها» page uses: the purchase fields with «قیمت روز خرید», the line that compares one
// asset with the dollar and inflation (rule 83), the edit form, and the add form.
import { useState } from 'react';
import { unitPrice } from '@/lib/finance/calc';
import { type AssetPerf } from '@/lib/finance/performance';
import { api } from '@/lib/api';
import { MARKET_ASSETS, newId, tomanToRial, type FinanceData, type MarketKey } from '@/lib/finance/model';
import { Toggle } from '../ui';
import { useFinance } from './FinanceProvider';
import { MANUAL_GROUP_ID } from '@/lib/finance/asset-groups';
import { fmtDateFa, fmtPctFa, JalaliDate, NumInput, parseAmount, SelectBox, TextInput, TomanInput } from './kit';

type Close = { date: string; value: number } | null;
/** closes of one asset on given days (or the last trading day before each), back to 2011 — /api/price-on */
export async function priceOn(asset: string, dates: string[]): Promise<{ unit: 'rial' | 'usd'; prices: Record<string, Close> }> {
  const r = await fetch(api(`/api/price-on?asset=${encodeURIComponent(asset)}&dates=${dates.join(',')}`));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || !j.prices) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** the rial price of one unit on a day, and the dollar that day (dollar-quoted coins are priced through it, rule 9) */
async function unitOnDay(key: MarketKey, date: string): Promise<{ rial: number; date: string; usdRial: number | null } | null> {
  const [own, usd] = await Promise.all([priceOn(key, [date]), key === 'usd' ? null : priceOn('usd', [date])]);
  const p = own.prices[date];
  const u = key === 'usd' ? p : usd!.prices[date];
  if (!p) return null;
  if (own.unit === 'rial') return { rial: p.value, date: p.date, usdRial: u?.value ?? null };
  if (!u) return null;
  return { rial: p.value * u.value, date: p.date < u.date ? p.date : u.date, usdRial: u.value };
}

/**
 * Purchase date and what was paid. «قیمت روز خرید» fills the total from the close of that day — or, when the market
 * was shut (Friday, a holiday), of the last trading day before it, and says so. History reaches back to 2011.
 */
export function PurchaseFields({ assetKey, qty, boughtOn, setBoughtOn, cost, setCost }: { assetKey: MarketKey | null; qty: number; boughtOn: string; setBoughtOn: (v: string) => void; cost: string; setCost: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function fill() {
    if (!assetKey) return;
    setBusy(true);
    setNote(null);
    try {
      const p = await unitOnDay(assetKey, boughtOn);
      if (!p) return setNote('برای آن روز قیمتی ثبت نشده (تاریخچه از ۱۳۹۰ است). مبلغ را دستی بنویسید.');
      setCost(String(Math.round((p.rial * qty) / 10)));
      setNote(
        p.date === boughtOn
          ? `قیمت ${fmtDateFa(p.date)}: هر واحد ${Math.round(p.rial / 10).toLocaleString('fa-IR')} تومان.`
          : `${fmtDateFa(boughtOn)} بازار تعطیل بود یا قیمتی ثبت نشد؛ قیمت آخرین روز کاری قبل از آن (${fmtDateFa(p.date)}) گذاشته شد: هر واحد ${Math.round(p.rial / 10).toLocaleString('fa-IR')} تومان.`,
      );
    } catch (e) {
      setNote(`دریافت قیمت ممکن نشد (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <JalaliDate label="تاریخ خرید" value={boughtOn} onChange={setBoughtOn} yearsBack={15} yearsAhead={0} />
      <TomanInput label="کل مبلغ خرید (تومان)" value={cost} onChange={setCost} placeholder="برای سود و زیان، و مقایسه با دلار و تورم" />
      {assetKey ? (
        <div className="fin-span fin-actions">
          <button className="fin-mini" type="button" onClick={fill} disabled={busy || !(qty > 0)}>
            {busy ? 'در حال گرفتن قیمت…' : 'قیمت روز خرید را بگذار'}
          </button>
          {note ? (
            <span className="muted small" role="status">
              {note}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const VERDICT: Record<'beat' | 'kept' | 'lost', string> = { beat: 'جلو زد', kept: 'هم‌پا ماند', lost: 'عقب ماند' };
export const usdFa = (v: number) => `${Math.round(v).toLocaleString('fa-IR')} دلار`;

/** one asset since it was bought: toman, dollars of each day, inflation */
export function PerfLine({ p }: { p: AssetPerf }) {
  return (
    <div className="asset-perf" data-testid="asset-perf">
      <span>
        رشد تومانی <b className={p.growthPct >= 0 ? 'up' : 'down'}>{fmtPctFa(p.growthPct, 1)}</b>
        {p.annualPct != null ? ` (سالانه ${fmtPctFa(p.annualPct, 1)})` : ''}
      </span>
      {p.costUsd != null && p.valueUsd != null ? (
        <span>
          به دلار: آن روز {usdFa(p.costUsd)} (دلار {Math.round(p.usdThenRial! / 10).toLocaleString('fa-IR')} تومان)، امروز {usdFa(p.valueUsd)} (دلار{' '}
          {Math.round(p.usdNowRial! / 10).toLocaleString('fa-IR')} تومان) — <b className={p.usdGrowthPct! >= 0 ? 'up' : 'down'}>{fmtPctFa(p.usdGrowthPct!, 1)}</b>؛ از دلار {VERDICT[p.vsDollar!]}
        </span>
      ) : (
        <span className="muted">قیمت دلار روز خرید هنوز نرسیده.</span>
      )}
      {p.inflation && p.realPct != null ? (
        <span>
          تورم همین مدت {fmtPctFa(p.inflation.pct, 0)}{p.inflation.basis !== 'official' ? '*' : ''} ← بعد از تورم{' '}
          <b className={p.realPct >= 0 ? 'up' : 'down'}>{fmtPctFa(p.realPct, 1)}</b>؛ از تورم {VERDICT[p.vsInflation!]}
        </span>
      ) : (
        <span className="muted">تورم پیش از ۱۳۸۴ در دسترس نیست.</span>
      )}
    </div>
  );
}

export function AssetEdit({ d, id, onDone }: { d: FinanceData; id: string; onDone: () => void }) {
  const { update, today } = useFinance();
  const a = d.assets.find((x) => x.id === id)!;
  const meta = a.key ? MARKET_ASSETS.find((x) => x.key === a.key) : null;
  const [qty, setQty] = useState(String(a.qty ?? ''));
  const [boughtOn, setBoughtOn] = useState(a.boughtOn ?? today);
  const [cost, setCost] = useState(a.costRial ? String(Math.round(a.costRial / 10)) : '');
  const [name, setName] = useState(a.name);
  const [value, setValue] = useState(a.valueRial ? String(Math.round(a.valueRial / 10)) : '');
  const [liquid, setLiquid] = useState(!!a.liquid);
  return (
    <div className="fin-grid fin-edit">
      {a.kind === 'market' && a.key && meta ? (
        <>
          <NumInput label={`مقدار (${meta.unit})`} value={qty} onChange={setQty} step={meta.step} />
          <PurchaseFields assetKey={a.key} qty={parseAmount(qty)} boughtOn={boughtOn} setBoughtOn={setBoughtOn} cost={cost} setCost={setCost} />
        </>
      ) : (
        <>
          <TextInput label="عنوان" value={name} onChange={setName} />
          <TomanInput label="ارزش تقریبی امروز (تومان)" value={value} onChange={setValue} />
          <PurchaseFields assetKey={null} qty={0} boughtOn={boughtOn} setBoughtOn={setBoughtOn} cost={cost} setCost={setCost} />
          <div className="fin-span">
            <Toggle checked={liquid} onChange={setLiquid}>
              ظرف یک هفته قابل فروش است
            </Toggle>
          </div>
        </>
      )}
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            update((dr) => {
              const x = dr.assets.find((y) => y.id === id);
              if (!x) return;
              if (x.kind === 'market') {
                const q = parseAmount(qty);
                if (q > 0) x.qty = q;
              } else {
                if (name.trim()) x.name = name.trim();
                const v = parseAmount(value);
                if (v > 0) x.valueRial = tomanToRial(v);
                x.liquid = liquid;
              }
              const c = parseAmount(cost);
              x.costRial = c > 0 ? tomanToRial(c) : null;
              x.boughtOn = c > 0 ? boughtOn : null;
            });
            onDone();
          }}
        >
          ذخیره
        </button>
        <button className="fin-mini ghost" onClick={onDone}>
          انصراف
        </button>
      </div>
    </div>
  );
}

/**
 * A new purchase: with a market price (gold, coins, dollar, crypto) or with a value of its own (car, house, رهن…).
 * Opened from a group, it starts on that kind. `onAdded` gets the id of the group the purchase landed in.
 */
export function AssetForm({ initialKey, initialMode = 'market', onDone, onAdded }: { initialKey?: MarketKey | null; initialMode?: 'market' | 'manual'; onDone: () => void; onAdded?: (groupId: string) => void }) {
  const { update, today, items } = useFinance();
  const [mode, setMode] = useState<'market' | 'manual'>(initialMode);
  const [key, setKey] = useState<MarketKey>(initialKey ?? 'g18');
  const [qty, setQty] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [liquid, setLiquid] = useState(false);
  const [boughtOn, setBoughtOn] = useState(today);
  const [cost, setCost] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const meta = MARKET_ASSETS.find((x) => x.key === key)!;
  const unitP = unitPrice(key, items);
  const unit = unitP?.rial ?? null;
  return (
    <div className="fin-grid" data-testid="asset-form">
      <SelectBox<'market' | 'manual'>
        label="نوع"
        value={mode}
        onChange={setMode}
        options={[{ key: 'market', label: 'با قیمت بازار (طلا، سکه، ارز، کریپتو)' }, { key: 'manual', label: 'با ارزش دستی (خودرو، ملک، رهن، سهام…)' }]}
      />
      {mode === 'market' ? (
        <>
          <SelectBox<MarketKey> label="دارایی" value={key} onChange={setKey} options={MARKET_ASSETS.map((x) => ({ key: x.key, label: x.label }))} />
          <NumInput
            label={`مقدار (${meta.unit})`}
            value={qty}
            onChange={setQty}
            step={meta.step}
            hint={unit ? `قیمت هر ${meta.unit}: ${Math.round(unit / 10).toLocaleString('fa-IR')} تومان${unitP?.asOf ? ` (آخرین قیمت، ${fmtDateFa(unitP.asOf)})` : ''}` : 'قیمت فعلاً در دسترس نیست'}
          />
          <PurchaseFields assetKey={key} qty={parseAmount(qty)} boughtOn={boughtOn} setBoughtOn={setBoughtOn} cost={cost} setCost={setCost} />
        </>
      ) : (
        <>
          <TextInput label="عنوان" value={name} onChange={setName} placeholder="مثلاً پژو ۲۰۷ مدل ۱۴۰۲" />
          <TomanInput label="ارزش تقریبی امروز (تومان)" value={value} onChange={setValue} />
          <PurchaseFields assetKey={null} qty={0} boughtOn={boughtOn} setBoughtOn={setBoughtOn} cost={cost} setCost={setCost} />
          <div className="fin-span">
            <Toggle checked={liquid} onChange={setLiquid}>
              ظرف یک هفته قابل فروش است (برای محاسبه صندوق اضطراری)
            </Toggle>
          </div>
        </>
      )}
      <div className="fin-span fin-actions">
        <button
          className="btn"
          data-testid="asset-save"
          onClick={() => {
            const c = parseAmount(cost);
            if (mode === 'market') {
              const q = parseAmount(qty);
              if (!(q > 0)) return setErr('مقدار را بنویسید.');
              update((dr) => void dr.assets.push({ id: newId('s'), name: meta.label, kind: 'market', key, qty: q, costRial: c > 0 ? tomanToRial(c) : null, boughtOn: c > 0 ? boughtOn : null }));
              onAdded?.(key);
            } else {
              const v = parseAmount(value);
              if (!name.trim()) return setErr('عنوان را بنویسید.');
              if (!(v > 0)) return setErr('ارزش امروز را بنویسید.');
              update((dr) => void dr.assets.push({ id: newId('s'), name: name.trim(), kind: 'manual', valueRial: tomanToRial(v), liquid, costRial: c > 0 ? tomanToRial(c) : null, boughtOn: c > 0 ? boughtOn : null }));
              onAdded?.(MANUAL_GROUP_ID);
            }
            onDone();
          }}
        >
          ذخیره
        </button>
        <button className="fin-mini ghost" onClick={onDone}>
          انصراف
        </button>
        {err ? <span className="fin-err" role="alert">{err}</span> : null}
      </div>
    </div>
  );
}
