'use client';
// آبان‌تتر (rules 101–102): prices, wallets, boxes, real orders with the user's own API key — from the phone straight to
// the exchange — and the switch that prices the app's bots as Abantether would. Every order is shown in full and sent
// only after the user confirms it; nothing trades on its own, and nothing here can withdraw.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { abanApi, loadKey, nativeTransport, saveKey, type AbanResult, type AccountType, type WalletType } from '@/lib/aban/client';
import { basisNote, type AbanBasis } from '@/lib/aban/basis';
import { basisOn, cachedBasis, currentBasis, setBasisOn } from '@/lib/aban/basis-store';
import {
  ABAN_TAG,
  assetsFromBalances,
  isOpenOrder,
  orderBody,
  orderChecks,
  parseBalances,
  parseCoinInfo,
  parseCoins,
  parseOrders,
  parseTicker,
  STATUS_FA,
  type BalanceRow,
  type CoinInfo,
  type CoinRow,
  type OrderInput,
  type OrderRow,
  type Quote,
  type Side,
  type TickerRow,
} from '@/lib/aban/parse';
import { newId, tomanToRial, type FinanceData } from '@/lib/finance/model';
import { PageHead, Toggle } from '../ui';
import { useFinance, WithBook } from '../finance/FinanceProvider';
import { Card, confirmDelete, Field, fmtDateFa, JalaliDate, Modal, Money, parseAmount, Tabs, TomanInput } from '../finance/kit';

type Tab = 'connect' | 'prices' | 'wallet' | 'trade' | 'orders' | 'boxes' | 'transfers';
const faN = (n: number, d = 8) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });
const ltr = (t: string) => `⁦${t}⁩`;
const qFa = (q: string | null) => (q === 'USDT' ? 'تتر' : 'تومان');
const WALLET_FA: Record<WalletType, string> = { spot: 'اصلی', credit: 'اعتباری', collateral: 'وثیقه' };
const ACCOUNT_FA: Record<AccountType, string> = { spot: 'کیف پول اصلی', credit: 'اعتباری', collateral: 'وثیقه', investment: 'سرمایه‌گذاری (باکس‌ها)' };

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

/** «مبنای قیمت ربات‌ها» (rule 102) */
function BasisCard() {
  const [on, setOn] = useState(true);
  const [b, setB] = useState<AbanBasis | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOn(basisOn());
    setB(cachedBasis());
  }, []);
  const refresh = async () => {
    setBusy(true);
    setB(await currentBasis(Date.now(), true));
    setBusy(false);
  };
  return (
    <Card title="مبنای قیمت ربات‌ها">
      <Toggle
        checked={on}
        onChange={(v) => {
          setOn(v);
          setBasisOn(v);
        }}
      >
        معامله برخط، نوسان‌گیری و فیوچرز با قیمت آبان‌تتر حساب شوند
      </Toggle>
      <p className="muted small">
        آبان‌تتر قیمت تومانی هر ارز را از قیمت جهانی دلاری‌اش ضرب در قیمت خرید یا فروش تتر خودش می‌سازد و ۰٫۳۸٪ کارمزد می‌گیرد. با این گزینه ربات‌ها همین را حساب می‌کنند:
        تبدیل به تومان با تتر آبان‌تتر، و هزینه هر طرف = کارمزد + نصف اختلاف خرید و فروش تتر. قیمت‌ها از فهرست عمومی صرافی، بدون کلید، از همین گوشی خوانده می‌شوند. ربات‌ها
        کاغذی می‌مانند و هیچ سفارشی به صرافی نمی‌فرستند.
      </p>
      {on ? (
        <>
          <p className="small" data-testid="aban-basis">
            {b ? `${basisNote(b)} (خوانده‌شده ${new Date(b.at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })})` : 'هنوز قیمتی از آبان‌تتر خوانده نشده؛ تا آن موقع ربات‌ها با قیمت تابلو کار می‌کنند.'}
          </p>
          <button className="fin-mini ghost" onClick={refresh} disabled={busy}>
            {busy ? 'در حال خواندن…' : 'خواندن قیمت‌ها از آبان‌تتر'}
          </button>
        </>
      ) : null}
    </Card>
  );
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
    <>
      <Card title="اتصال با کلید API">
        <ol className="small aban-steps">
          <li>در سایت آبان‌تتر وارد شوید و از صفحه «حساب کاربری» پنل، Api-Key خود را بردارید.</li>
          <li>کلید را این‌جا بچسبانید. فقط روی همین گوشی می‌ماند؛ به سرور «مالی من» نمی‌رود و در فایل پشتیبان هم نیست.</li>
          <li>«آزمایش اتصال» موجودی را از صرافی می‌خواند.</li>
        </ol>
        <p className="banner warn small">
          به گفته خود آبان‌تتر، این کلید منقضی نمی‌شود و مثل نام کاربری و رمز عبور شماست — با آن می‌شود برداشت هم کرد. «مالی من» برداشت را عمداً نساخته، ولی گوشی را قفل نگه دارید و
          اگر گوشی گم شد، کلید را از صفحه «امنیت» پنل آبان‌تتر غیرفعال کنید.
        </p>
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
            وصل شد. {faN(parseBalances(res.json).length, 0)} دارایی در کیف پول اصلی دیدیم.
          </p>
        ) : null}
        <Err r={res} />
        <Raw r={res} />
      </Card>
      <BasisCard />
    </>
  );
}

function Prices({ ticker, res, load }: { ticker: TickerRow[]; res: AbanResult | null; load: () => void }) {
  const [q, setQ] = useState('');
  const shown = ticker.filter((t) => !q.trim() || t.symbol.includes(q.trim().toUpperCase()));
  return (
    <Card title="قیمت خرید و فروش (تومان)" action={<button className="fin-mini ghost" onClick={load}>به‌روزرسانی</button>}>
      <p className="muted small">«خرید شما» قیمتی است که برای خرید هر واحد می‌پردازید و «فروش شما» آن‌چه با فروشش می‌گیرید — از فهرست عمومی آبان‌تتر، بدون کلید. کارمزد ۰٫۳۸٪ جداست.</p>
      <Field label="جست‌وجوی ارز">
        <input className="fin-input" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder="BTC, TON…" aria-label="جست‌وجوی ارز" />
      </Field>
      <Err r={res} />
      {shown.length ? (
        <ul className="fin-list" data-testid="aban-ticker">
          {shown.slice(0, 120).map((t) => (
            <li key={`${t.symbol}-${t.quote}`}>
              <span className="fin-list-main">
                <b>{ltr(t.symbol)}</b>
                <small>{t.active ? `به ${qFa(t.quote)}` : 'غیرفعال'}</small>
              </span>
              <span className="fin-list-nums aban-quote">
                <span>
                  <small>خرید شما</small> {t.buy !== null ? faN(t.buy, t.buy < 100 ? 4 : 0) : '—'}
                </span>
                <span>
                  <small>فروش شما</small> {t.sell !== null ? faN(t.sell, t.sell < 100 ? 4 : 0) : '—'}
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

function Wallet({ d, ticker, coins }: { d: FinanceData; ticker: TickerRow[]; coins: CoinRow[] }) {
  const { update } = useFinance();
  const [type, setType] = useState<WalletType>('spot');
  const [res, setRes] = useState<AbanResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => void abanApi.balances(type).then(setRes), [type]);
  useEffect(() => {
    load();
  }, [load]);
  const balances = useMemo(() => (res?.ok ? parseBalances(res.json) : []), [res]);
  const sync = () => {
    let msg = '';
    update((dr) => {
      const r = assetsFromBalances(dr.assets, balances, ticker, () => newId('as'), coins);
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
      <Field label="کدام کیف پول">
        <select className="fin-input" aria-label="کدام کیف پول" value={type} onChange={(e) => setType(e.target.value as WalletType)}>
          {(Object.keys(WALLET_FA) as WalletType[]).map((k) => (
            <option key={k} value={k}>
              {WALLET_FA[k]}
            </option>
          ))}
        </select>
      </Field>
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
            تتر، بیت‌کوین و اتریوم با قیمت تابلو ارزش‌گذاری می‌شوند؛ ارزهای دیگر و باکس‌ها با قیمت فروش خود آبان‌تتر، همان لحظه. موجودی تومانی کیف پول را اگر خواستید به‌عنوان یک
            حساب در «حساب‌ها و کارت‌ها» بسازید. هزینه خریدشان معلوم نیست، پس سودشان «نامشخص» می‌ماند تا خودتان در <Link href="/assets">سرمایه‌ها</Link> بنویسید.
            {synced ? ` (${faN(synced, 0)} دارایی از آبان‌تتر در دفتر هست؛ دوباره زدن همان‌ها را به‌روز می‌کند.)` : ''}
          </p>
        </>
      ) : res?.ok ? (
        <p className="muted">این کیف پول خالی است.</p>
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

export interface TradePreset {
  base: string;
  account?: AccountType;
}

function Trade({ ticker, preset, onPlaced }: { ticker: TickerRow[]; preset: TradePreset | null; onPlaced: () => void }) {
  const [kind, setKind] = useState<'market' | 'limit'>('market');
  const [side, setSide] = useState<Side>('buy');
  const [base, setBase] = useState(preset?.base ?? '');
  const [quote, setQuote] = useState<Quote>('IRT');
  const [account, setAccount] = useState<AccountType>(preset?.account ?? 'spot');
  const [volume, setVolume] = useState('');
  const [price, setPrice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AbanResult | null>(null);
  const [info, setInfo] = useState<CoinInfo | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  useEffect(() => {
    if (preset) {
      setBase(preset.base);
      setAccount(preset.account ?? 'spot');
    }
  }, [preset]);
  useEffect(() => {
    void abanApi.balances(account === 'investment' ? 'spot' : account).then((r) => setBalances(r.ok ? parseBalances(r.json) : []));
  }, [account]);
  // the exchange's limits and fee for this coin and side
  useEffect(() => {
    setInfo(null);
    if (!/^[A-Z0-9]{2,15}$/.test(base)) return;
    const t = setTimeout(() => void abanApi.coinInfo(base, side).then((r) => setInfo(r.ok ? parseCoinInfo(r.json, quote) : null)), 400);
    return () => {
      clearTimeout(t);
    };
  }, [base, side, quote]);
  const input: OrderInput = { kind, side, base, quote, volume: parseAmount(volume), price: kind === 'limit' ? parseAmount(price) : null, account };
  const body = orderBody(input);
  const checks = orderChecks(input, ticker, balances, info);
  const close = useCallback(() => setConfirm(false), []);
  const unitFa = side === 'buy' ? qFa(quote) : base || 'ارز';

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

  const summary = () => {
    const what = side === 'buy' ? `خرید ${ltr(base)} با ${faN(input.volume, 4)} ${qFa(quote)}` : `فروش ${faN(input.volume)} ${ltr(base)}`;
    return `${what} ${kind === 'market' ? 'با قیمت بازار' : `با قیمت ${faN(input.price!, 4)} ${qFa(quote)}`}`;
  };

  return (
    <Card title="سفارش واقعی">
      <p className="banner warn small" data-testid="aban-real">
        این سفارش با پول واقعی در حساب آبان‌تتر شما انجام می‌شود و برگشت‌پذیر نیست. «مالی من» هیچ سفارشی را خودش نمی‌فرستد و پیشنهاد خرید و فروش نمی‌دهد؛ ربات‌های این اپ
        کاغذی‌اند و به صرافی سفارش نمی‌دهند.
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
              <option key={`${t.symbol}-${t.quote}`} value={t.symbol} />
            ))}
          </datalist>
        </Field>
        <Field label="با">
          <select className="fin-input" aria-label="با" value={quote} onChange={(e) => setQuote(e.target.value as Quote)}>
            <option value="IRT">تومان</option>
            <option value="USDT">تتر</option>
          </select>
        </Field>
        <Field label={side === 'buy' ? `چقدر ${qFa(quote)} خرج شود` : `مقدار فروش (${base || 'ارز'})`}>
          <input className="fin-input" inputMode="decimal" dir="ltr" aria-label={side === 'buy' ? 'مبلغ خرید' : 'مقدار فروش'} value={volume} onChange={(e) => setVolume(e.target.value)} placeholder={side === 'buy' ? '1000000' : '0.5'} />
        </Field>
        {kind === 'limit' ? (
          <Field label={`قیمت هر واحد (${qFa(quote)})`}>
            <input className="fin-input" inputMode="decimal" dir="ltr" aria-label="قیمت هر واحد" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        ) : null}
        <Field label="از کدام حساب">
          <select className="fin-input" aria-label="از کدام حساب" value={account} onChange={(e) => setAccount(e.target.value as AccountType)}>
            {(Object.keys(ACCOUNT_FA) as AccountType[]).map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_FA[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {checks.price !== null && input.volume > 0 ? (
        <p className="small" data-testid="aban-value">
          {side === 'buy'
            ? `حدود ${faN(checks.coinQty ?? 0, 6)} ${base} می‌گیرید (قیمت هر واحد ${faN(checks.price, 4)} ${qFa(quote)}، بعد از کارمزد ${faN(checks.feePct, 2)}٪)`
            : `حدود ${faN(checks.quoteValue ?? 0, quote === 'IRT' ? 0 : 4)} ${qFa(quote)} می‌گیرید (قیمت هر واحد ${faN(checks.price, 4)}، بعد از کارمزد ${faN(checks.feePct, 2)}٪)`}
          {kind === 'market' ? '؛ قیمت نهایی را صرافی هنگام اجرا تعیین می‌کند.' : ''}
        </p>
      ) : null}
      {info ? (
        <p className="muted small">
          حداقل و حداکثر هر معامله: {faN((quote === 'IRT' ? info.minIrt : info.minUsdt) ?? 0, 2)} تا {faN((quote === 'IRT' ? info.maxIrt : info.maxUsdt) ?? 0, 2)} {qFa(quote)}
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
          صرافی سفارش را پذیرفت ({STATUS_FA[parseOrders(res.json)[0]?.status ?? ''] ?? parseOrders(res.json)[0]?.status ?? 'ثبت شد'}). وضعیتش را در «سفارش‌ها» ببینید.
        </p>
      ) : null}
      <Err r={res} />
      <Raw r={res} />
      {confirm && typeof body !== 'string' ? (
        <Modal title="تأیید سفارش واقعی" onClose={close}>
          <p>
            <b>{summary()}</b>
          </p>
          <p className="small muted">
            {side === 'buy' ? 'در سفارش خرید، آبان‌تتر مبلغ را به تومان/تتر می‌گیرد، نه تعداد ارز. ' : ''}
            از حساب: {ACCOUNT_FA[account]}
          </p>
          {checks.warnings.map((w) => (
            <p key={w} className="fin-hint">
              {w}
            </p>
          ))}
          <details className="fin-details">
            <summary>آن‌چه به صرافی فرستاده می‌شود</summary>
            <pre className="fin-raw" dir="ltr">{`POST api.abantether.com/api/v1/order_handler/orders/otc/${kind}\n${JSON.stringify(body, null, 2)}`}</pre>
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

function OrderLine({ o, onCancel, onRefresh }: { o: OrderRow; onCancel: (o: OrderRow) => void; onRefresh: (o: OrderRow) => void }) {
  const amount = o.side === 'buy' ? (o.volQuote ? `${faN(o.volQuote, 4)} ${qFa(o.quote)}` : null) : o.volBase ? `${faN(o.volBase)} ${o.base ?? ''}` : null;
  const filled = o.filledBase ? `انجام‌شده: ${faN(o.filledBase)} ${o.base ?? ''}${o.filledQuote ? ` / ${faN(o.filledQuote, 4)} ${qFa(o.quote)}` : ''}` : null;
  return (
    <li data-testid="aban-order">
      <span className="fin-list-main">
        <b>
          {o.side === 'buy' ? 'خرید' : o.side === 'sell' ? 'فروش' : 'سفارش'} {o.base ? ltr(o.base) : ''} {o.type === 'limit' ? '(محدود)' : o.type === 'market' ? '(بازار)' : ''}
        </b>
        <small>
          {o.status ? (STATUS_FA[o.status] ?? o.status) : 'وضعیت نامعلوم'}
          {o.at ? `، ${o.at.slice(0, 16).replace('T', ' ')}` : ''}
          {o.code ? `، کد ${o.code}` : ''}
        </small>
        {filled ? <small>{filled}</small> : null}
      </span>
      <span className="fin-list-nums">
        {amount ? <b className="money">{amount}</b> : null}
        {o.price !== null ? <small>قیمت {faN(o.price, 4)}</small> : null}
      </span>
      {o.id ? (
        <span className="fin-actions">
          <button className="fin-mini ghost" onClick={() => onRefresh(o)}>
            وضعیت
          </button>
          {isOpenOrder(o) ? (
            <button className="fin-mini ghost" onClick={() => onCancel(o)}>
              لغو
            </button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

function Orders() {
  const [res, setRes] = useState<AbanResult | null>(null);
  const [cres, setCres] = useState<AbanResult | null>(null);
  const [page, setPage] = useState(1);
  const [override, setOverride] = useState<Record<string, OrderRow>>({});
  const load = useCallback(() => void abanApi.orders(page).then(setRes), [page]);
  useEffect(() => {
    load();
  }, [load]);
  const orders = useMemo(() => (res?.ok ? parseOrders(res.json).map((o) => override[o.id] ?? o) : []), [res, override]);
  const total = res?.ok ? Number((res.json as { page_count?: unknown })?.page_count) || 1 : 1;
  const cancel = async (o: OrderRow) => {
    if (!window.confirm(`سفارش ${o.side === 'buy' ? 'خرید' : o.side === 'sell' ? 'فروش' : ''} ${o.base ?? ''} لغو شود؟`)) return;
    const r = await abanApi.cancel(o.id);
    setCres(r);
    if (r.ok) load();
  };
  const refresh = async (o: OrderRow) => {
    const r = await abanApi.order(o.id);
    const one = r.ok ? parseOrders(r.json)[0] : null;
    if (one) setOverride((x) => ({ ...x, [o.id]: one }));
    else setCres(r);
  };
  return (
    <Card title="سفارش‌های من" action={<button className="fin-mini ghost" onClick={load}>به‌روزرسانی</button>}>
      <Err r={res} />
      {orders.length ? (
        <ul className="fin-list" data-testid="aban-orders">
          {orders.map((o) => (
            <OrderLine key={o.id || `${o.at}-${o.base}`} o={o} onCancel={(x) => void cancel(x)} onRefresh={(x) => void refresh(x)} />
          ))}
        </ul>
      ) : res?.ok ? (
        <p className="muted">سفارشی نیست.</p>
      ) : null}
      {total > 1 ? (
        <div className="fin-actions">
          <button className="fin-mini ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            قبلی
          </button>
          <span className="small">
            صفحه {faN(page, 0)} از {faN(total, 0)}
          </span>
          <button className="fin-mini ghost" disabled={page >= total} onClick={() => setPage((p) => p + 1)}>
            بعدی
          </button>
        </div>
      ) : null}
      <Err r={cres} />
      <Raw r={res} />
    </Card>
  );
}

/**
 * The investment boxes: in the coin list they are the coins of type FUND (GET /api/v2/manager/coins), bought and sold
 * with the same OTC orders; the docs list «investment» among the order account types. Recording one by hand stays.
 */
function Boxes({ d, coins, coinsRes, onTrade }: { d: FinanceData; coins: CoinRow[]; coinsRes: AbanResult | null; onTrade: (p: TradePreset) => void }) {
  const { update, today } = useFinance();
  const funds = coins.filter((c) => c.type === 'FUND');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState<string | null>(null);
  const boxes = d.assets.filter((a) => a.name.startsWith(`${ABAN_TAG} — `) && a.kind === 'manual');
  const add = () => {
    const costRial = tomanToRial(parseAmount(cost));
    const valueRial = value ? tomanToRial(parseAmount(value)) : costRial;
    if (!name.trim()) return setNote('نام باکس را بنویسید.');
    if (!(valueRial > 0)) return setNote('مبلغ را بنویسید.');
    update((dr) => {
      dr.assets.push({ id: newId('as'), name: `${ABAN_TAG} — ${name.trim()}`, kind: 'manual', valueRial, liquid: true, costRial: costRial > 0 ? costRial : null, boughtOn: date });
    });
    setCost('');
    setValue('');
    setNote(`«${name.trim()}» در سرمایه‌ها ثبت شد. ارزش فعلی‌اش را هر وقت خواستید از همان‌جا به‌روز کنید.`);
  };
  return (
    <>
      <Card title="باکس‌های سرمایه‌گذاری">
        <p className="muted small">
          در فهرست ارزهای آبان‌تتر، باکس‌ها دارایی‌هایی از نوع «FUND» هستند و با همان سفارش خرید و فروش معامله می‌شوند. سود ادعایی هر باکس تضمین‌شده نیست و ریسک دارد.
        </p>
        <Err r={coinsRes} />
        {funds.length ? (
          <ul className="fin-list" data-testid="aban-funds">
            {funds.map((c) => (
              <li key={c.symbol}>
                <span className="fin-list-main">
                  <b>{c.persian ?? c.name}</b>
                  <small>
                    {ltr(c.symbol)}
                    {c.change24h !== null ? `، ۲۴ ساعت ${c.change24h > 0 ? '+' : ''}${faN(c.change24h, 2)}٪` : ''}
                  </small>
                </span>
                <span className="fin-list-nums aban-quote">
                  <span>
                    <small>خرید</small> {c.buy !== null ? faN(c.buy, 0) : '—'}
                  </span>
                  <span>
                    <small>فروش</small> {c.sell !== null ? faN(c.sell, 0) : '—'}
                  </span>
                </span>
                {c.canBuy || c.canSell ? (
                  <button className="fin-mini ghost" onClick={() => onTrade({ base: c.symbol, account: 'investment' })}>
                    معامله
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : coinsRes?.ok ? (
          <p className="muted">در فهرست ارزهای صرافی، دارایی از نوع باکس (FUND) پیدا نشد.</p>
        ) : null}
        <p className="muted small">
          برای معامله باکس، حساب «سرمایه‌گذاری» پیش‌فرض می‌شود (مستندات آن را در انواع حساب سفارش نام برده)؛ اگر صرافی نپذیرفت، «کیف پول اصلی» را امتحان کنید.
        </p>
        <Raw r={coinsRes} />
      </Card>
      <Card title="ثبت دستی باکس در سرمایه‌ها">
        <div className="fin-grid">
          <Field label="نام باکس">
            <input className="fin-input" aria-label="نام باکس" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً گلدباکس" list="aban-box-names" />
            <datalist id="aban-box-names">
              {funds.map((c) => (
                <option key={c.symbol} value={c.persian ?? c.name} />
              ))}
            </datalist>
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
    </>
  );
}

/** read-only: blockchain deposits and withdrawals (the app never withdraws) */
function Transfers() {
  const [type, setType] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [res, setRes] = useState<AbanResult | null>(null);
  useEffect(() => {
    void abanApi.transfers(type).then(setRes);
  }, [type]);
  const rows = useMemo(() => {
    const p = res?.ok ? (res.json as { data?: unknown }).data : null;
    return Array.isArray(p) ? (p as Record<string, unknown>[]) : [];
  }, [res]);
  return (
    <Card title="واریز و برداشت رمزارز">
      <p className="muted small">فقط نمایش. «مالی من» برداشت ثبت نمی‌کند — برای برداشت از خود آبان‌تتر استفاده کنید.</p>
      <Field label="نوع">
        <select className="fin-input" aria-label="نوع" value={type} onChange={(e) => setType(e.target.value as 'DEPOSIT' | 'WITHDRAWAL')}>
          <option value="DEPOSIT">واریزها</option>
          <option value="WITHDRAWAL">برداشت‌ها</option>
        </select>
      </Field>
      <Err r={res} />
      {rows.length ? (
        <ul className="fin-list" data-testid="aban-transfers">
          {rows.map((t) => (
            <li key={String(t.id)}>
              <span className="fin-list-main">
                <b>
                  {ltr(String(t.coin ?? ''))} ({String(t.network ?? '')})
                </b>
                <small>
                  {String(t.state ?? '')}
                  {t.created_at ? `، ${String(t.created_at).slice(0, 16).replace('T', ' ')}` : ''}
                </small>
              </span>
              <span className="fin-list-nums">
                <b className="num">{String(t.amount ?? '')}</b>
              </span>
            </li>
          ))}
        </ul>
      ) : res?.ok ? (
        <p className="muted">موردی نیست.</p>
      ) : null}
      <Raw r={res} />
    </Card>
  );
}

function Page({ d }: { d: FinanceData }) {
  const [tab, setTab] = useState<Tab>('prices');
  const [hasKey, setHasKey] = useState(false);
  const [tickerRes, setTickerRes] = useState<AbanResult | null>(null);
  const [coinsRes, setCoinsRes] = useState<AbanResult | null>(null);
  const [preset, setPreset] = useState<TradePreset | null>(null);
  const ticker = useMemo(() => (tickerRes?.ok ? parseTicker(tickerRes.json) : []), [tickerRes]);
  const coins = useMemo(() => (coinsRes?.ok ? parseCoins(coinsRes.json) : []), [coinsRes]);
  const loadTicker = useCallback(() => void abanApi.ticker().then(setTickerRes), []);
  const loadCoins = useCallback(() => void abanApi.coins().then(setCoinsRes), []);

  useEffect(() => {
    const k = !!loadKey();
    setHasKey(k);
    if (!k) setTab('connect');
  }, []);
  useEffect(() => {
    if ((tab === 'prices' || tab === 'trade' || tab === 'wallet') && !tickerRes) loadTicker();
    if ((tab === 'boxes' || tab === 'wallet') && !coinsRes) loadCoins();
  }, [tab, tickerRes, coinsRes, loadTicker, loadCoins]);

  const needKey = !hasKey && (tab === 'wallet' || tab === 'trade' || tab === 'orders' || tab === 'transfers');
  return (
    <>
      <PageHead title="آبان‌تتر">
        قیمت‌ها، کیف پول، باکس‌ها و سفارش واقعی در صرافی آبان‌تتر با کلید API خودتان — مستقیم از همین گوشی به صرافی؛ کلید و سفارش‌ها از سرور «مالی من» رد نمی‌شوند. هیچ سفارشی
        بدون تأیید شما فرستاده نمی‌شود و برداشت از این‌جا ممکن نیست.
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
          { key: 'transfers', label: 'واریز و برداشت' },
          { key: 'connect', label: hasKey ? 'کلید و مبنا' : 'اتصال' },
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
          <Connect hasKey={hasKey} onKey={() => setHasKey(!!loadKey())} />
        ) : tab === 'prices' ? (
          <Prices ticker={ticker} res={tickerRes} load={loadTicker} />
        ) : tab === 'wallet' ? (
          <Wallet d={d} ticker={ticker} coins={coins} />
        ) : tab === 'trade' ? (
          <Trade ticker={ticker} preset={preset} onPlaced={() => undefined} />
        ) : tab === 'orders' ? (
          <Orders />
        ) : tab === 'boxes' ? (
          <Boxes
            d={d}
            coins={coins}
            coinsRes={coinsRes}
            onTrade={(p) => {
              setPreset(p);
              setTab(hasKey ? 'trade' : 'connect');
            }}
          />
        ) : (
          <Transfers />
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
