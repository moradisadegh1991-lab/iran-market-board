'use client';
// آبان‌تتر (rule 101): prices, balances, real orders with the user's own API key — from the phone straight to the
// exchange. Every order is shown in full and sent only after the user confirms it; nothing trades on its own.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { abanApi, loadKey, nativeTransport, saveKey, type AbanResult } from '@/lib/aban/client';
import { ABAN_TAG, assetsFromBalances, BOX_KINDS, isOpenOrder, orderBody, orderChecks, parseBalances, parseOrders, parseTicker, type BalanceRow, type OrderInput, type OrderRow, type Quote, type Side, type TickerRow } from '@/lib/aban/parse';
import { newId, tomanToRial, type FinanceData } from '@/lib/finance/model';
import { PageHead } from '../ui';
import { useFinance, WithBook } from '../finance/FinanceProvider';
import { Card, confirmDelete, Field, fmtDateFa, JalaliDate, Modal, Money, parseAmount, Tabs, TomanInput } from '../finance/kit';

type Tab = 'connect' | 'prices' | 'wallet' | 'trade' | 'orders' | 'boxes';
const faN = (n: number, d = 8) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });
const ltr = (t: string) => `⁦${t}⁩`;

function Raw({ r }: { r: AbanResult | null }) {
  if (!r) return null;
  return (
    <details className="fin-details" data-testid="aban-raw">
      <summary>پاسخ خام صرافی ({r.status || 'بدون پاسخ'})</summary>
      <pre className="fin-raw">{`${r.url}\n${typeof r.json === 'string' ? r.json : JSON.stringify(r.json, null, 2)}`.slice(0, 4000)}</pre>
    </details>
  );
}

function Err({ r }: { r: AbanResult | null }) {
  return r && !r.ok ? (
    <p className="fin-err" role="alert">
      {r.error}
    </p>
  ) : null;
}

function Connect({ hasKey, onKey }: { hasKey: boolean; onKey: () => void }) {
  const [key, setKey] = useState('');
  const [res, setRes] = useState<AbanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setRes(await abanApi.balances());
    setBusy(false);
  };
  return (
    <Card title="اتصال با کلید API">
      <ol className="small aban-steps">
        <li>
          در سایت یا اپ آبان‌تتر وارد شوید و از بخش API پنل کاربری یک کلید بسازید. اگر صرافی اجازه می‌دهد، دسترسی <b>برداشت</b> را برای این کلید خاموش بگذارید — این صفحه فقط
          قیمت، موجودی و سفارش لازم دارد.
        </li>
        <li>کلید را این‌جا بچسبانید. فقط روی همین گوشی می‌ماند؛ به سرور «مالی من» نمی‌رود و در فایل پشتیبان هم نیست.</li>
        <li>«آزمایش اتصال» موجودی را از صرافی می‌خواند.</li>
      </ol>
      {!nativeTransport() ? (
        <p className="banner info" data-testid="aban-browser">
          این‌جا مرورگر است: درخواست‌ها مستقیم از مرورگر به صرافی می‌روند و صرافی ممکن است آن‌ها را نپذیرد. در اپ اندروید «مالی من» این محدودیت نیست.
        </p>
      ) : null}
      <div className="fin-grid">
        <Field label={hasKey ? 'کلید تازه (کلید فعلی ذخیره است)' : 'کلید API'}>
          <input className="fin-input" type="password" autoComplete="off" spellCheck={false} dir="ltr" aria-label="کلید API" value={key} onChange={(e) => setKey(e.target.value)} placeholder="•••••••" />
        </Field>
      </div>
      <div className="fin-actions">
        <button
          className="fin-mini"
          disabled={!key.trim()}
          onClick={() => {
            saveKey(key);
            setKey('');
            onKey();
          }}
          data-testid="aban-save-key"
        >
          ذخیره کلید
        </button>
        <button className="fin-mini ghost" disabled={!hasKey || busy} onClick={test}>
          {busy ? 'در حال آزمایش…' : 'آزمایش اتصال'}
        </button>
        {hasKey ? (
          <button
            className="fin-mini ghost"
            onClick={() => {
              if (confirmDelete('کلید API آبان‌تتر از این گوشی')) {
                saveKey('');
                onKey();
                setRes(null);
              }
            }}
          >
            حذف کلید
          </button>
        ) : null}
      </div>
      {res?.ok ? (
        <p className="fin-ok" role="status">
          وصل شد. {faN(parseBalances(res.json).length, 0)} دارایی در کیف پول دیدیم.
        </p>
      ) : null}
      <Err r={res} />
      <Raw r={res} />
      <p className="muted small">
        این اتصال با مستندات عمومی API آبان‌تتر ساخته شده و هنوز با یک حساب واقعی آزمایش نشده است. اگر چیزی درست خوانده نشد، «پاسخ خام صرافی» را ببینید.
      </p>
    </Card>
  );
}

function Prices({ ticker, res, load }: { ticker: TickerRow[]; res: AbanResult | null; load: () => void }) {
  const [q, setQ] = useState('');
  const shown = ticker.filter((t) => !q.trim() || t.symbol.includes(q.trim().toUpperCase()));
  return (
    <Card title="قیمت خرید و فروش" action={<button className="fin-mini ghost" onClick={load}>به‌روزرسانی</button>}>
      <p className="muted small">قیمتی که صرافی می‌خرد (شما می‌فروشید) و می‌فروشد (شما می‌خرید)، از فهرست عمومی آبان‌تتر — بدون کلید.</p>
      <Field label="جست‌وجوی ارز">
        <input className="fin-input" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder="BTC, TON…" aria-label="جست‌وجوی ارز" />
      </Field>
      <Err r={res} />
      {shown.length ? (
        <ul className="fin-list" data-testid="aban-ticker">
          {shown.slice(0, 80).map((t) => (
            <li key={t.symbol}>
              <span className="fin-list-main">
                <b>{ltr(t.symbol)}</b>
                <small>{t.quote === 'USDT' ? 'به تتر' : 'به تومان'}</small>
              </span>
              <span className="fin-list-nums aban-quote">
                <span>
                  <small>خرید شما</small> {t.sell !== null ? faN(t.sell) : '—'}
                </span>
                <span>
                  <small>فروش شما</small> {t.buy !== null ? faN(t.buy) : '—'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : res?.ok ? (
        <p className="muted">صرافی فهرستی برگرداند که خوانده نشد — «پاسخ خام» را ببینید.</p>
      ) : null}
      <Raw r={res} />
    </Card>
  );
}

function Wallet({ d, balances, ticker, res, load }: { d: FinanceData; balances: BalanceRow[]; ticker: TickerRow[]; res: AbanResult | null; load: () => void }) {
  const { update } = useFinance();
  const [note, setNote] = useState<string | null>(null);
  const sync = () => {
    let msg = '';
    update((dr) => {
      const r = assetsFromBalances(dr.assets, balances, ticker, () => newId('as'));
      for (const a of r.upsert) {
        const i = dr.assets.findIndex((x) => x.id === a.id);
        if (i >= 0) dr.assets[i] = a;
        else dr.assets.push(a);
      }
      msg = `${faN(r.upsert.length, 0)} دارایی در «سرمایه‌ها» ثبت یا به‌روز شد${r.skipped.length ? `؛ ${r.skipped.join('، ')} قیمت تومانی در صرافی نداشت و ثبت نشد` : ''}.`;
    });
    setNote(msg);
  };
  const synced = d.assets.filter((a) => a.name.startsWith(ABAN_TAG)).length;
  return (
    <Card title="کیف پول آبان‌تتر" action={<button className="fin-mini ghost" onClick={load}>به‌روزرسانی</button>}>
      <Err r={res} />
      {balances.length ? (
        <>
          <ul className="fin-list" data-testid="aban-balances">
            {balances.map((b) => (
              <li key={b.symbol}>
                <span className="fin-list-main">
                  <b>{ltr(b.symbol)}</b>
                  <small>
                    {b.available !== null ? `آزاد ${faN(b.available)}` : ''}
                    {b.blocked ? `، در سفارش ${faN(b.blocked)}` : ''}
                  </small>
                </span>
                <span className="fin-list-nums">
                  <b className="num">{faN(b.balance)}</b>
                </span>
              </li>
            ))}
          </ul>
          <div className="fin-actions">
            <button className="fin-mini" onClick={sync} data-testid="aban-sync">
              افزودن به «سرمایه‌ها»
            </button>
          </div>
          <p className="muted small">
            تتر، بیت‌کوین و اتریوم با قیمت تابلو ارزش‌گذاری می‌شوند؛ ارزهای دیگر با قیمت خرید خود آبان‌تتر، همان لحظه. موجودی تومانی کیف پول را اگر خواستید به‌عنوان یک حساب در
            «حساب‌ها و کارت‌ها» بسازید. هزینه خریدشان معلوم نیست، پس سودشان «نامشخص» می‌ماند تا خودتان در <Link href="/assets">سرمایه‌ها</Link> بنویسید.
            {synced ? ` (${faN(synced, 0)} دارایی از آبان‌تتر در دفتر هست؛ دوباره زدن همان‌ها را به‌روز می‌کند.)` : ''}
          </p>
        </>
      ) : res?.ok ? (
        <p className="muted">کیف پول خالی است (یا پاسخ صرافی خوانده نشد).</p>
      ) : null}
      {note ? (
        <p className="fin-ok" role="status">
          {note}
        </p>
      ) : null}
      <Raw r={res} />
    </Card>
  );
}

function Trade({ ticker, balances, onPlaced }: { ticker: TickerRow[]; balances: BalanceRow[]; onPlaced: () => void }) {
  const [kind, setKind] = useState<'market' | 'limit'>('market');
  const [side, setSide] = useState<Side>('buy');
  const [base, setBase] = useState('');
  const [quote, setQuote] = useState<Quote>('IRT');
  const [volume, setVolume] = useState('');
  const [price, setPrice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AbanResult | null>(null);
  const input: OrderInput = { kind, side, base, quote, volume: parseAmount(volume), price: kind === 'limit' ? parseAmount(price) : null };
  const body = orderBody(input);
  const checks = orderChecks(input, ticker, balances);
  const close = useCallback(() => setConfirm(false), []);

  const send = async () => {
    if (typeof body === 'string') return;
    setBusy(true);
    const r = await abanApi.place(kind, body);
    setBusy(false);
    setRes(r);
    setConfirm(false);
    setSure(false);
    if (r.ok) onPlaced();
  };

  return (
    <Card title="سفارش واقعی">
      <p className="banner warn small" data-testid="aban-real">
        این سفارش با پول واقعی در حساب آبان‌تتر شما انجام می‌شود و برگشت‌پذیر نیست. «مالی من» هیچ سفارشی را خودش نمی‌فرستد و پیشنهاد خرید و فروش نمی‌دهد؛ موتورهای
        معامله این اپ کاغذی‌اند و به صرافی وصل نیستند.
      </p>
      <div className="fin-grid">
        <Field label="نوع سفارش">
          <select className="fin-input" aria-label="نوع سفارش" value={kind} onChange={(e) => setKind(e.target.value as 'market' | 'limit')}>
            <option value="market">بازار (با قیمت فعلی صرافی)</option>
            <option value="limit">محدود (با قیمتی که می‌گویید)</option>
          </select>
        </Field>
        <Field label="خرید یا فروش">
          <select className="fin-input" aria-label="خرید یا فروش" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="buy">خرید</option>
            <option value="sell">فروش</option>
          </select>
        </Field>
        <Field label="ارز">
          <input className="fin-input" dir="ltr" aria-label="ارز" value={base} onChange={(e) => setBase(e.target.value.toUpperCase())} placeholder="TON" list="aban-coins" />
          <datalist id="aban-coins">
            {ticker.map((t) => (
              <option key={t.symbol} value={t.symbol} />
            ))}
          </datalist>
        </Field>
        <Field label="به">
          <select className="fin-input" aria-label="به" value={quote} onChange={(e) => setQuote(e.target.value as Quote)}>
            <option value="IRT">تومان</option>
            <option value="USDT">تتر</option>
          </select>
        </Field>
        <Field label={`مقدار (${base || 'ارز'})`}>
          <input className="fin-input" inputMode="decimal" dir="ltr" aria-label="مقدار" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="0.5" />
        </Field>
        {kind === 'limit' ? (
          <Field label={`قیمت هر واحد (${quote === 'IRT' ? 'تومان' : 'تتر'})`}>
            <input className="fin-input" inputMode="decimal" dir="ltr" aria-label="قیمت هر واحد" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        ) : null}
      </div>
      {checks.value !== null ? (
        <p className="small" data-testid="aban-value">
          ارزش تقریبی: {faN(checks.value, quote === 'IRT' ? 0 : 4)} {quote === 'IRT' ? 'تومان' : 'تتر'}
          {kind === 'market' ? ' (قیمت نهایی را صرافی هنگام اجرا تعیین می‌کند؛ کارمزد جداست)' : ''}
        </p>
      ) : null}
      {checks.warnings.map((w) => (
        <p key={w} className="fin-hint">
          {w}
        </p>
      ))}
      {typeof body === 'string' && (base || volume) ? <p className="muted small">{body}</p> : null}
      <div className="fin-actions">
        <button className="fin-mini" disabled={typeof body === 'string'} onClick={() => setConfirm(true)} data-testid="aban-review">
          بررسی و ارسال
        </button>
      </div>
      {res?.ok ? (
        <p className="fin-ok" role="status" data-testid="aban-placed">
          صرافی سفارش را پذیرفت. وضعیتش را در «سفارش‌ها» ببینید.
        </p>
      ) : null}
      <Err r={res} />
      <Raw r={res} />
      {confirm && typeof body !== 'string' ? (
        <Modal title="تأیید سفارش واقعی" onClose={close}>
          <p>
            <b>
              {side === 'buy' ? 'خرید' : 'فروش'} {faN(input.volume)} {ltr(body.base_symbol)} {kind === 'market' ? 'با قیمت بازار' : `با قیمت ${faN(input.price!)} ${quote === 'IRT' ? 'تومان' : 'تتر'}`}
            </b>
          </p>
          {checks.value !== null ? (
            <p className="small">
              حدود {faN(checks.value, quote === 'IRT' ? 0 : 4)} {quote === 'IRT' ? 'تومان' : 'تتر'}
            </p>
          ) : null}
          {checks.warnings.map((w) => (
            <p key={w} className="fin-hint">
              {w}
            </p>
          ))}
          <details className="fin-details">
            <summary>آن‌چه به صرافی فرستاده می‌شود</summary>
            <pre className="fin-raw" dir="ltr">{`POST api.abantether.com/…/orders/otc/${kind}\n${JSON.stringify(body, null, 2)}`}</pre>
          </details>
          <label className="toggle">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="aban-sure" />
            <span className="track" aria-hidden="true" />
            <span>می‌دانم این سفارش واقعی است و با موجودی واقعی من در آبان‌تتر انجام می‌شود.</span>
          </label>
          <div className="fin-actions">
            <button className="fin-mini" disabled={!sure || busy} onClick={send} data-testid="aban-send">
              {busy ? 'در حال ارسال…' : 'ارسال سفارش'}
            </button>
            <button className="fin-mini ghost" onClick={close}>
              انصراف
            </button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function Orders({ orders, res, load }: { orders: OrderRow[]; res: AbanResult | null; load: () => void }) {
  const [cres, setCres] = useState<AbanResult | null>(null);
  const cancel = async (o: OrderRow) => {
    if (!window.confirm(`سفارش ${o.side === 'buy' ? 'خرید' : o.side === 'sell' ? 'فروش' : ''} ${o.base ?? ''} لغو شود؟`)) return;
    const r = await abanApi.cancel(o.id);
    setCres(r);
    if (r.ok) load();
  };
  return (
    <Card title="سفارش‌های من" action={<button className="fin-mini ghost" onClick={load}>به‌روزرسانی</button>}>
      <Err r={res} />
      {orders.length ? (
        <ul className="fin-list" data-testid="aban-orders">
          {orders.map((o) => (
            <li key={o.id || `${o.at}-${o.base}`}>
              <span className="fin-list-main">
                <b>
                  {o.side === 'buy' ? 'خرید' : o.side === 'sell' ? 'فروش' : 'سفارش'} {o.base ? ltr(o.base) : ''}
                  {o.quote ? ` / ${ltr(o.quote)}` : ''}
                </b>
                <small>
                  {o.status ?? 'وضعیت نامعلوم'}
                  {o.at ? ` · ${o.at.slice(0, 16).replace('T', ' ')}` : ''}
                </small>
              </span>
              <span className="fin-list-nums">
                {o.volume !== null ? <b className="num">{faN(o.volume)}</b> : null}
                {o.price !== null ? <small>قیمت {faN(o.price)}</small> : null}
              </span>
              {o.id && isOpenOrder(o) ? (
                <button className="fin-mini ghost" onClick={() => void cancel(o)}>
                  لغو
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : res?.ok ? (
        <p className="muted">سفارشی نیست (یا پاسخ صرافی خوانده نشد).</p>
      ) : null}
      <Err r={cres} />
      <Raw r={res} />
    </Card>
  );
}

/** No public API for the investment boxes was found: they are recorded by hand, as assets with their own value. */
function Boxes({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [kind, setKind] = useState(BOX_KINDS[0]);
  const [cost, setCost] = useState('');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState<string | null>(null);
  const boxes = d.assets.filter((a) => a.name.startsWith(`${ABAN_TAG} — `) && BOX_KINDS.some((k) => a.name.includes(k)));
  const add = () => {
    const costRial = tomanToRial(parseAmount(cost));
    const valueRial = value ? tomanToRial(parseAmount(value)) : costRial;
    if (!(valueRial > 0)) return setNote('مبلغ را بنویسید.');
    update((dr) => {
      dr.assets.push({ id: newId('as'), name: `${ABAN_TAG} — ${kind}`, kind: 'manual', valueRial, liquid: true, costRial: costRial > 0 ? costRial : null, boughtOn: date });
    });
    setCost('');
    setValue('');
    setNote(`«${kind}» در سرمایه‌ها ثبت شد. ارزش فعلی‌اش را هر وقت خواستید از همان‌جا به‌روز کنید.`);
  };
  return (
    <Card title="باکس‌های سرمایه‌گذاری">
      <p className="muted small">
        در مستندات عمومی API آبان‌تتر راهی برای خواندن یا خریدن باکس‌ها (فیکس‌باکس، گلدباکس، …) پیدا نکردیم، پس این‌جا نمی‌توانیم مستقیم از صرافی بخوانیمشان. می‌توانید هر باکس را با
        مبلغ و تاریخ سرمایه‌گذاری ثبت کنید تا در دارایی خالص و مقایسه با دلار و تورم بیاید. سود ادعایی هر باکس تضمین‌شده نیست.
      </p>
      <div className="fin-grid">
        <Field label="کدام باکس">
          <select className="fin-input" aria-label="کدام باکس" value={kind} onChange={(e) => setKind(e.target.value)}>
            {BOX_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <TomanInput label="مبلغ سرمایه‌گذاری (تومان)" value={cost} onChange={setCost} />
        <TomanInput label="ارزش فعلی (تومان، اگر فرق دارد)" value={value} onChange={setValue} />
        <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsBack={5} yearsAhead={0} />
      </div>
      <div className="fin-actions">
        <button className="fin-mini" onClick={add} disabled={!cost && !value}>
          ثبت در سرمایه‌ها
        </button>
      </div>
      {note ? <p className="fin-ok" role="status">{note}</p> : null}
      {boxes.length ? (
        <ul className="fin-list">
          {boxes.map((b) => (
            <li key={b.id}>
              <span className="fin-list-main">
                <b>{b.name.replace(`${ABAN_TAG} — `, '')}</b>
                <small>{b.boughtOn ? fmtDateFa(b.boughtOn) : ''}</small>
              </span>
              <span className="fin-list-nums">
                <Money rial={b.valueRial ?? 0} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Page({ d }: { d: FinanceData }) {
  const [tab, setTab] = useState<Tab>('prices');
  const [hasKey, setHasKey] = useState(false);
  const [tickerRes, setTickerRes] = useState<AbanResult | null>(null);
  const [balRes, setBalRes] = useState<AbanResult | null>(null);
  const [ordRes, setOrdRes] = useState<AbanResult | null>(null);
  const ticker = useMemo(() => (tickerRes?.ok ? parseTicker(tickerRes.json) : []), [tickerRes]);
  const balances = useMemo(() => (balRes?.ok ? parseBalances(balRes.json) : []), [balRes]);
  const orders = useMemo(() => (ordRes?.ok ? parseOrders(ordRes.json) : []), [ordRes]);

  const loadTicker = useCallback(() => void abanApi.ticker().then(setTickerRes), []);
  const loadBal = useCallback(() => void abanApi.balances().then(setBalRes), []);
  const loadOrders = useCallback(() => void abanApi.orders().then(setOrdRes), []);

  useEffect(() => {
    const k = !!loadKey();
    setHasKey(k);
    if (!k) setTab('connect');
  }, []);
  useEffect(() => {
    if ((tab === 'prices' || tab === 'trade') && !tickerRes) loadTicker();
    if ((tab === 'wallet' || tab === 'trade') && hasKey && !balRes) loadBal();
    if (tab === 'orders' && hasKey && !ordRes) loadOrders();
  }, [tab, hasKey, tickerRes, balRes, ordRes, loadTicker, loadBal, loadOrders]);

  const needKey = !hasKey && (tab === 'wallet' || tab === 'trade' || tab === 'orders');
  return (
    <>
      <PageHead title="آبان‌تتر">
        قیمت‌ها، موجودی کیف پول و سفارش واقعی در صرافی آبان‌تتر با کلید API خودتان — مستقیم از همین گوشی به صرافی؛ کلید و سفارش‌ها از سرور «مالی من» رد نمی‌شوند. هیچ سفارشی
        بدون تأیید شما فرستاده نمی‌شود.
      </PageHead>
      <Tabs<Tab>
        label="بخش‌های آبان‌تتر"
        idPrefix="aban"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'prices', label: 'قیمت‌ها' },
          { key: 'wallet', label: 'کیف پول' },
          { key: 'trade', label: 'معامله' },
          { key: 'orders', label: 'سفارش‌ها' },
          { key: 'boxes', label: 'باکس‌ها' },
          { key: 'connect', label: hasKey ? 'کلید API' : 'اتصال' },
        ]}
      />
      <div id="aban-panel" role="tabpanel">
        {needKey ? (
          <p className="banner info">
            برای این بخش کلید API لازم است.{' '}
            <button className="fin-mini" onClick={() => setTab('connect')}>
              اتصال
            </button>
          </p>
        ) : tab === 'connect' ? (
          <Connect
            hasKey={hasKey}
            onKey={() => {
              setHasKey(!!loadKey());
              setBalRes(null);
              setOrdRes(null);
            }}
          />
        ) : tab === 'prices' ? (
          <Prices ticker={ticker} res={tickerRes} load={loadTicker} />
        ) : tab === 'wallet' ? (
          <Wallet d={d} balances={balances} ticker={ticker} res={balRes} load={loadBal} />
        ) : tab === 'trade' ? (
          <Trade
            ticker={ticker}
            balances={balances}
            onPlaced={() => {
              setBalRes(null);
              setOrdRes(null);
            }}
          />
        ) : tab === 'orders' ? (
          <Orders orders={orders} res={ordRes} load={loadOrders} />
        ) : (
          <Boxes d={d} />
        )}
      </div>
    </>
  );
}

export default function AbanView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Page d={d} />}</WithBook>
    </div>
  );
}
