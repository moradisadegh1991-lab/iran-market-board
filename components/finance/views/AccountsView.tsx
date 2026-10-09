'use client';
import { useEffect, useRef, useState } from 'react';
import { accountBalances, netWorth, unitPrice } from '@/lib/finance/calc';
import { assetPerformance, portfolioPerformance, type AssetPerf } from '@/lib/finance/performance';
import { CPI_SOURCE } from '@/lib/finance/inflation';
import { api } from '@/lib/api';
import { deleteAccount, editAccount } from '@/lib/finance/actions';
import { ACCOUNT_KIND_LABEL, USER_ACCOUNT_KINDS, emptyData, MARKET_ASSETS, newId, normalizeData, tomanToRial, type AccountKind, type FinanceData, type MarketKey } from '@/lib/finance/model';
import { Empty, PageHead, Toggle } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import ClassicMigrate from '../ClassicMigrate';
import { createAccountForSource, linkSource, sourceLabel } from '@/lib/finance/sources';
import { BalanceSource } from '../BalanceChecks';
import { Card, confirmDelete, Disclosure, fmtDateFa, fmtPctFa, JalaliDate, Money, NumInput, parseAmount, SelectBox, TextInput, TomanInput } from '../kit';
import { download } from './TransactionsView';

/** Cards and bank accounts the app found in SMS: link each to an account, or make one for it. */
function SmsSources({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [showIgnored, setShowIgnored] = useState(false);
  const list = (d.smsSources ?? []).filter((s) => showIgnored || !s.ignored).sort((a, b) => b.lastAt - a.lastAt);
  if (!(d.smsSources ?? []).length) return null;
  const accounts = d.accounts.filter((a) => !a.archived && a.kind !== 'person');
  return (
    <Card title="کارت‌ها و حساب‌های شناخته‌شده از پیامک">
      <p className="muted small">
        از پیامک‌های بانکی پیدا شده‌اند. هر کدام را به یکی از حساب‌هایتان وصل کنید تا تراکنش‌های بعدی‌اش خودکار به همان حساب برود و موجودی حساب از مانده‌ای که بانک می‌گوید
        حساب شود.
      </p>
      <ul className="fin-list">
        {list.map((s) => (
          <li key={s.key} className={s.ignored ? 'muted' : ''} data-testid="sms-source">
            <span className="fin-list-main">
              <b>{sourceLabel(s)}</b>
              <small>
                {s.count.toLocaleString('fa-IR')} پیامک · آخرین: {new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(s.lastAt))}
                {s.lastBalanceRial !== null ? ' · آخرین مانده: ' : ''}
                {s.lastBalanceRial !== null ? <Money rial={s.lastBalanceRial} /> : null}
              </small>
            </span>
            <select
              className="fin-input sm"
              aria-label={`حساب ${sourceLabel(s)}`}
              value={s.accountId ?? ''}
              onChange={(e) => update((dr) => linkSource(dr, s.key, e.target.value || null))}
            >
              <option value="">— وصل نیست —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {!s.accountId ? (
              <>
                <button className="fin-mini" onClick={() => update((dr) => void createAccountForSource(dr, s.key, sourceLabel(s), today))}>
                  ساخت حساب تازه
                </button>
                <button className="fin-mini ghost" onClick={() => update((dr) => void (dr.smsSources.find((x) => x.key === s.key)!.ignored = !s.ignored))}>
                  {s.ignored ? 'برگرداندن' : 'مال من نیست'}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {(d.smsSources ?? []).some((s) => s.ignored) ? (
        <button className="linkish" onClick={() => setShowIgnored((v) => !v)}>
          {showIgnored ? 'پنهان کردن موارد کنارگذاشته' : 'نمایش موارد کنارگذاشته'}
        </button>
      ) : null}
    </Card>
  );
}

/** Name, kind, start date and today's balance of an account; the balance moves only the opening balance. */
function AccountEdit({ d, id, onDone }: { d: FinanceData; id: string; onDone: () => void }) {
  const { update } = useFinance();
  const a = d.accounts.find((x) => x.id === id)!;
  const current = accountBalances(d)[id] ?? 0;
  const [name, setName] = useState(a.name);
  const [kind, setKind] = useState<AccountKind>(a.kind);
  const [balance, setBalance] = useState(String(Math.round(current / 10)));
  const [openedOn, setOpenedOn] = useState(a.openedOn);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fin-grid fin-edit">
      <TextInput label="نام" value={name} onChange={setName} />
      {USER_ACCOUNT_KINDS.includes(a.kind) ? (
        <SelectBox<AccountKind> label="نوع" value={kind} onChange={setKind} options={USER_ACCOUNT_KINDS.map((k) => ({ key: k, label: ACCOUNT_KIND_LABEL[k] }))} />
      ) : null}
      <TomanInput label="موجودی فعلی (تومان)" value={balance} onChange={setBalance} />
      <JalaliDate label="تاریخ شروع ثبت این حساب" value={openedOn} onChange={setOpenedOn} />
      <p className="fin-span muted small">
        {a.reported
          ? 'موجودی‌ای که می‌نویسید مثل مانده بانک در همین لحظه حساب می‌شود؛ تراکنش‌های ثبت‌شده دست نمی‌خورند.'
          : 'تغییر موجودی فقط «موجودی اول دوره» را جابه‌جا می‌کند؛ تراکنش‌های ثبت‌شده دست نمی‌خورند.'}
      </p>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            const b = parseAmount(balance);
            let e: string | null = null;
            update((dr) => {
              e = editAccount(dr, id, { name, kind, openedOn, currentRial: Number.isFinite(b) && tomanToRial(b) !== Math.round(current) ? tomanToRial(b) : null });
            });
            setErr(e);
            if (!e) onDone();
          }}
        >
          ذخیره
        </button>
        <button className="fin-mini ghost" onClick={onDone}>
          انصراف
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </div>
  );
}

function Accounts({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const bal = accountBalances(d);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [opening, setOpening] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="حساب‌ها">
      {d.accounts.length ? (
        <ul className="fin-list">
          {d.accounts.filter((a) => a.kind !== 'person').map((a) => (
            <li key={a.id} className={`fin-list-block${a.archived ? ' muted' : ''}`}>
              <div className="fin-list-row">
              <span className="fin-list-main">
                <b>{a.name}</b>
                <small>
                  {ACCOUNT_KIND_LABEL[a.kind]}
                  {a.archived ? ' · بایگانی' : ''}
                  {(d.smsSources ?? []).filter((s) => s.accountId === a.id).map((s) => ` · ${sourceLabel(s)}`).join('')}
                </small>
                <BalanceSource d={d} accountId={a.id} />
              </span>
              <Money rial={bal[a.id] ?? 0} />
              <button className="fin-mini" onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id}>
                ویرایش
              </button>
              <button className="fin-mini" onClick={() => update((dr) => void (dr.accounts.find((x) => x.id === a.id)!.archived = !a.archived))}>
                {a.archived ? 'بازگردانی' : 'بایگانی'}
              </button>
              <button
                className="fin-mini ghost"
                onClick={() => {
                  if (!confirmDelete(`حساب «${a.name}»`)) return;
                  let err: string | null = null;
                  update((dr) => {
                    err = deleteAccount(dr, a.id);
                  });
                  setMsg(err);
                }}
              >
                حذف
              </button>
              </div>
              {editing === a.id ? <AccountEdit d={d} id={a.id} onDone={() => setEditing(null)} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>حسابی ندارید.</Empty>
      )}
      {msg ? <p className="fin-err">{msg}</p> : null}
      <Disclosure label="+ حساب تازه" defaultOpen={d.accounts.length < 2 && !d.txns.length}>
        {(close) => (
          <div className="fin-grid">
            <TextInput label="نام" value={name} onChange={setName} placeholder="مثلاً حساب حقوق ملت" />
            <SelectBox<AccountKind> label="نوع" value={kind} onChange={setKind} options={USER_ACCOUNT_KINDS.map((k) => ({ key: k, label: ACCOUNT_KIND_LABEL[k] }))} />
            <TomanInput label="موجودی امروز (تومان)" value={opening} onChange={setOpening} placeholder="۰" />
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  if (!name.trim()) return;
                  update((dr) => void dr.accounts.push({ id: newId('a'), name: name.trim(), kind, openingRial: tomanToRial(parseAmount(opening) || 0), openedOn: today }));
                  setName('');
                  setOpening('');
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
      <p className="note">
        موجودی کارت و حسابی که به پیامک بانک وصل است، آخرین مانده‌ای است که بانک گفته به‌علاوه تراکنش‌هایی که بعد از آن ثبت شده؛ اگر «موجودی اول ماه + تراکنش‌های این ماه» با آن
        نخواند، همین‌جا می‌پرسیم چرا. حساب بدون پیامک (مثل کیف پول نقد) از روی تراکنش‌ها حساب می‌شود؛ اگر فرق کرد، از «ویرایش» موجودی فعلی را بنویسید.
      </p>
    </Card>
  );
}

const USD_QUOTED: MarketKey[] = ['btc', 'eth'];

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
function PurchaseFields({ assetKey, qty, boughtOn, setBoughtOn, cost, setCost }: { assetKey: MarketKey | null; qty: number; boughtOn: string; setBoughtOn: (v: string) => void; cost: string; setCost: (v: string) => void }) {
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
const usdFa = (v: number) => `${Math.round(v).toLocaleString('fa-IR')} دلار`;

/** one asset since it was bought: toman, dollars of each day, inflation */
function PerfLine({ p }: { p: AssetPerf }) {
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

function AssetEdit({ d, id, onDone }: { d: FinanceData; id: string; onDone: () => void }) {
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

function Assets({ d }: { d: FinanceData }) {
  const { update, today, items } = useFinance();
  const nw = netWorth(d, items, today);
  const [mode, setMode] = useState<'market' | 'manual'>('market');
  const [key, setKey] = useState<MarketKey>('g18');
  const [qty, setQty] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [liquid, setLiquid] = useState(false);
  const [boughtOn, setBoughtOn] = useState(today);
  const [cost, setCost] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const meta = MARKET_ASSETS.find((x) => x.key === key)!;
  const unitP = unitPrice(key, items);
  const unit = unitP?.rial ?? null;
  const usdNow = unitPrice('usd', items)?.rial ?? null;
  const perf = new Map<string, AssetPerf>();
  for (const a of d.assets) {
    const p = assetPerformance(a, nw.byAsset.find((x) => x.id === a.id)?.rial ?? null, usdNow, today, d.settings.inflationPct);
    if (p) perf.set(a.id, p);
  }
  const total = portfolioPerformance([...perf.values()]);
  // the dollar on each purchase day: looked up once and kept on the asset (it never changes)
  const missing = d.assets.filter((a) => a.boughtOn && a.costRial && a.usdAtBuyFor !== a.boughtOn);
  const want = [...new Set(missing.map((a) => a.boughtOn!))].sort().join(',');
  useEffect(() => {
    if (!want) return;
    let live = true;
    void priceOn('usd', want.split(','))
      .then((r) => {
        if (!live) return;
        update((dr) => {
          for (const a of dr.assets) {
            if (!a.boughtOn || !a.costRial || a.usdAtBuyFor === a.boughtOn) continue;
            const c = r.prices[a.boughtOn];
            if (c === undefined) continue;
            a.usdRialAtBuy = c ? c.value : null;
            a.usdAtBuyFor = a.boughtOn;
          }
        });
      })
      .catch(() => {
        // offline: next time
      });
    return () => {
      live = false;
    };
  }, [want, update]);
  return (
    <Card title="دارایی‌ها">
      <dl className="fin-kpis tight">
        <div className="fin-stat">
          <dt>دارایی خالص</dt>
          <dd>
            <Money rial={nw.netRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>حساب‌ها</dt>
          <dd>
            <Money rial={nw.cashRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>طلا، ارز، کریپتو</dt>
          <dd>
            <Money rial={nw.marketRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>سایر دارایی‌ها</dt>
          <dd>
            <Money rial={nw.manualRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>طلب − بدهی</dt>
          <dd>
            <Money rial={nw.receivableRial - nw.debtRial} short signed />
          </dd>
        </div>
      </dl>
      {nw.unpriced.length ? <p className="banner warn">قیمت این موارد در دسترس نیست و در جمع حساب نشده‌اند: {nw.unpriced.join('، ')}</p> : null}
      {nw.lastPriced.length ? (
        <p className="banner info">
          بازار بسته است (جمعه یا تعطیل) یا قیمت لحظه‌ای نرسید؛ این دارایی‌ها با آخرین قیمت ثبت‌شده حساب شده‌اند:{' '}
          {nw.lastPriced.map((x) => `${x.name} (${fmtDateFa(x.asOf)})`).join('، ')}
        </p>
      ) : null}
      {total ? (
        <div className="asset-perf-total" data-testid="asset-perf-total">
          <b>از روز خرید تا امروز ({total.count.toLocaleString('fa-IR')} دارایی با تاریخ و مبلغ خرید)</b>
          <span>
            خرید <Money rial={total.costRial} short />، امروز <Money rial={total.valueRial} short /> ← <b className={total.growthPct >= 0 ? 'up' : 'down'}>{fmtPctFa(total.growthPct, 1)}</b>
          </span>
          {total.usdGrowthPct != null ? (
            <span>
              به دلار هر روز: {usdFa(total.costUsd!)} ← {usdFa(total.valueUsd!)} (<b className={total.usdGrowthPct >= 0 ? 'up' : 'down'}>{fmtPctFa(total.usdGrowthPct, 1)}</b>)
            </span>
          ) : null}
          {total.realPct != null ? (
            <span>
              بعد از تورم: <b className={total.realPct >= 0 ? 'up' : 'down'}>{fmtPctFa(total.realPct, 1)}</b> — یعنی قدرت خریدش {total.realPct >= 0 ? 'بیشتر' : 'کمتر'} شده.
            </span>
          ) : null}
          <small className="muted">
            تورم از {CPI_SOURCE}؛ * بعد از آن با تورم سالانه {d.settings.inflationPct.toLocaleString('fa-IR')}٪ تنظیمات. دلار: نرخ بازار آزاد روز خرید (یا آخرین روز کاری قبلش). گذشته وعده آینده
            نیست.
          </small>
        </div>
      ) : null}
      {d.assets.length ? (
        <ul className="fin-list">
          {d.assets.map((a) => {
            const row = nw.byAsset.find((x) => x.id === a.id);
            const v = row?.rial ?? null;
            const m = a.key ? MARKET_ASSETS.find((x) => x.key === a.key) : null;
            return (
              <li key={a.id} className="fin-list-block">
                <div className="fin-list-row">
                <span className="fin-list-main">
                  <b>{a.name}</b>
                  <small>
                    {a.kind === 'market'
                      ? `${(a.qty ?? 0).toLocaleString('fa-IR', { maximumFractionDigits: 6 })} ${m?.unit ?? ''} · ${row?.asOf ? `آخرین قیمت ${fmtDateFa(row.asOf)}` : 'قیمت لحظه‌ای'}`
                      : a.liquid
                        ? 'قابل نقد شدن سریع'
                        : 'غیرنقد'}
                  </small>
                  {a.costRial && v !== null ? (
                    <small>
                      خرید <Money rial={a.costRial} short />
                      {a.boughtOn ? ` در ${fmtDateFa(a.boughtOn)}` : ''}، سود/زیان{' '}
                      <Money rial={v - a.costRial} short signed className={v >= a.costRial ? 'up' : 'down'} />
                    </small>
                  ) : a.kind === 'manual' || !a.boughtOn ? (
                    <small className="muted">با «ویرایش» تاریخ و مبلغ خرید را بنویسید تا با دلار و تورم مقایسه شود.</small>
                  ) : null}
                </span>
                <Money rial={v} />
                <button className="fin-mini" onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id}>
                  ویرایش
                </button>
                <button className="fin-mini ghost" onClick={() => confirmDelete(`«${a.name}»`) && update((dr) => void (dr.assets = dr.assets.filter((x) => x.id !== a.id)))}>
                  حذف
                </button>
                </div>
                {perf.get(a.id) ? <PerfLine p={perf.get(a.id)!} /> : null}
                {editing === a.id ? <AssetEdit d={d} id={a.id} onDone={() => setEditing(null)} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty art="wallet">طلا، سکه، ارز، کریپتو، خودرو، ودیعه رهن یا سهام را اضافه کنید.</Empty>
      )}
      <Disclosure label="+ دارایی تازه">
        {(close) => (
          <div className="fin-grid">
            <SelectBox<'market' | 'manual'> label="نوع" value={mode} onChange={setMode} options={[{ key: 'market', label: 'با قیمت بازار (طلا، سکه، ارز، کریپتو)' }, { key: 'manual', label: 'با ارزش دستی (خودرو، ملک، رهن، سهام…)' }]} />
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
                onClick={() => {
                  if (mode === 'market') {
                    const q = parseAmount(qty);
                    if (!(q > 0)) return;
                    const c = parseAmount(cost);
                    update((dr) => void dr.assets.push({ id: newId('s'), name: meta.label, kind: 'market', key, qty: q, costRial: c > 0 ? tomanToRial(c) : null, boughtOn: c > 0 ? boughtOn : null }));
                    setQty('');
                    setCost('');
                  } else {
                    const v = parseAmount(value);
                    if (!name.trim() || !(v > 0)) return;
                    const c = parseAmount(cost);
                    update((dr) => void dr.assets.push({ id: newId('s'), name: name.trim(), kind: 'manual', valueRial: tomanToRial(v), liquid, costRial: c > 0 ? tomanToRial(c) : null, boughtOn: c > 0 ? boughtOn : null }));
                    setName('');
                    setValue('');
                    setCost('');
                  }
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
    </Card>
  );
}

function SettingField({ d, k, label, hint }: { d: FinanceData; k: keyof FinanceData['settings']; label: string; hint: string }) {
  const { update } = useFinance();
  const [v, setV] = useState(String(d.settings[k]));
  const n = parseAmount(v);
  const valid = Number.isFinite(n) && n >= 0 && n <= 1000;
  return (
    <NumInput
      label={label}
      hint={valid ? hint : 'عدد نامعتبر — ذخیره نشد'}
      value={v}
      onChange={(x) => {
        setV(x);
        const m = parseAmount(x);
        if (Number.isFinite(m) && m >= 0 && m <= 1000) update((dr) => void (dr.settings[k] = m));
      }}
    />
  );
}

function SettingsCard({ d }: { d: FinanceData }) {
  return (
    <Card title="تنظیمات">
      <div className="fin-grid">
        <SettingField d={d} k="inflationPct" label="تورم سالانه مورد انتظار (٪)" hint="برای قیمت آینده اهداف و بازده واقعی" />
        <SettingField d={d} k="safeYieldPct" label="سود صندوق درآمد ثابت (٪ سالانه)" hint="حداقل بازدهی که هر انتخاب دیگری باید از آن بیشتر باشد" />
        <SettingField d={d} k="emergencyMonths" label="صندوق اضطراری (ماه خرج)" hint="معمولاً ۳ تا ۶ ماه؛ برای درآمد ناپایدار بیشتر" />
      </div>
    </Card>
  );
}

function Backup({ d }: { d: FinanceData }) {
  const { replace, today } = useFinance();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="پشتیبان و انتقال">
      <p className="muted small">
        دفتر فقط در همین مرورگر است؛ پاک کردن داده‌های مرورگر یا عوض کردن گوشی آن را از بین می‌برد. هر چند وقت یک بار فایل پشتیبان بگیرید. فایل پشتیبان رمزگذاری نشده؛ جای امنی نگهش دارید.
      </p>
      <div className="fin-actions">
        <button className="btn" onClick={() => void download(`mali-man-backup-${today}.json`, JSON.stringify(d, null, 1), 'application/json')}>
          دریافت فایل پشتیبان
        </button>
        <button className="fin-mini" onClick={() => file.current?.click()}>
          بازگردانی از فایل
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const next = normalizeData(JSON.parse(await f.text()), today);
              if (!window.confirm(`دفتر فعلی با این فایل جایگزین شود؟ (${next.txns.length.toLocaleString('fa-IR')} تراکنش، ${next.accounts.length.toLocaleString('fa-IR')} حساب)`)) return;
              replace(next);
              setMsg('بازگردانی شد.');
            } catch (err) {
              setMsg(err instanceof Error ? err.message : 'فایل خوانده نشد.');
            }
          }}
        />
        <button
          className="fin-mini ghost"
          onClick={() => {
            if (window.confirm('همه داده‌های مالی این مرورگر پاک شود؟ اول پشتیبان بگیرید.') && window.confirm('مطمئن هستید؟ این کار برگشت ندارد.')) {
              replace(emptyData(today));
              setMsg('دفتر خالی شد.');
            }
          }}
        >
          پاک کردن همه
        </button>
      </div>
      {msg ? (
        <p className="note" role="status">
          {msg}
        </p>
      ) : null}
    </Card>
  );
}

function Page({ d }: { d: FinanceData }) {
  return (
    <>
      <PageHead title="حساب‌ها و کارت‌ها">موجودی کارت‌ها و حساب‌ها (از پیامک بانک)، دارایی‌هایی که با قیمت روز ارزش‌گذاری می‌شوند، تنظیمات محاسبه و پشتیبان‌گیری.</PageHead>
      <Accounts d={d} />
      <SmsSources d={d} />
      <Assets d={d} />
      <SettingsCard d={d} />
      <Backup d={d} />
      <ClassicMigrate d={d} always />
    </>
  );
}

export default function AccountsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Page d={d} />}</WithBook>
    </div>
  );
}
