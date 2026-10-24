'use client';
// «فیوچرز (اهرم)» (rule 95): a calculator with the exchange's own liquidation formula, a paper futures account
// on this device (manual long/short, or the trend rider at a chosen leverage), and what each leverage step did
// to the trend rider on real data. No order ever reaches an exchange.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDateTimeFa as fdt, fmtInt, isNum } from '@/lib/num';
import { liqPrice, unrealised, type FuturesFill, type FUTURES_EVIDENCE, type Side } from '@/lib/engine/futures';
import { equityOf, type FuturesAccount } from '@/lib/engine/futures-account';
import type { FuturesBacktest } from '@/lib/futures-data';
import { callFutures, futFillNote, FUT_TICK_MS, loadFutures, saveFutures, type FutAction } from '@/lib/futures-local';
import { useNotify } from '../NotifyProvider';
import { useSnapshot } from '../SnapshotProvider';
import { Chips, Empty, PageHead, Pct } from '../ui';
import { usePicks } from '../swing/CoinPicks';
import { cachedBasis, currentBasis } from '@/lib/aban/basis-store';
import type { AbanBasis } from '@/lib/aban/basis';

interface Meta {
  sym: string;
  price: number | null;
  funding: { rate: number; next: number | null; via: 'okx' | 'assumed' };
  leverages: number[];
  maxLeverage: number;
  mmr: number;
  takerFee: number;
  coins: { sym: string; name: string; maxLeverage: number }[];
  evidence: typeof FUTURES_EVIDENCE;
  backtest: (FuturesBacktest & { error?: undefined }) | { error: string } | null;
  error?: string;
}

const usdt = (n: number | null | undefined, d = 2) => (isNum(n) ? n!.toLocaleString('fa-IR', { maximumFractionDigits: d }) : '—');
/** price with enough digits for PEPE and BTC alike */
const px = (n: number | null | undefined) => (!isNum(n) ? '—' : n! >= 100 ? usdt(n, 2) : n! >= 1 ? usdt(n, 4) : n!.toLocaleString('fa-IR', { maximumSignificantDigits: 5 }));
const numIn = (s: string) => Number(s.replace(/[٬,]/g, '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));

function Evidence({ e }: { e: typeof FUTURES_EVIDENCE }) {
  return (
    <details className="method evidence" open>
      <summary>اهرم روی داده واقعی: روندسوار روی قرارداد دائمی {fmtInt(e.coins)} ارز</summary>
      <div className="table-scroll">
        <table className="t compact" data-testid="fut-evidence">
          <caption>میانه {fmtInt(e.coins)} ارز؛ لیکویید روی کمترین/بیشترین قیمت هر روز، فاندینگ واقعی بایننس، کارمزد ۰٫۰۵٪ هر طرف</caption>
          <thead>
            <tr>
              <th scope="col">اهرم</th>
              <th scope="col">بازده سالانه {e.design}</th>
              <th scope="col">افت</th>
              <th scope="col">بازده سالانه {e.test}</th>
              <th scope="col">افت</th>
              <th scope="col">از دست دادن ۹۰٪+ (آزمون)</th>
            </tr>
          </thead>
          <tbody>
            {e.rows.map((r) => (
              <tr key={r.lev} className={r.lev === 1 ? 'sel' : ''}>
                <th scope="row" className="num">{fmtInt(r.lev)}×</th>
                <td><Pct v={r.design.cagr} digits={0} /></td>
                <td><Pct v={r.design.dd} digits={0} /></td>
                <td><Pct v={r.test.cagr} digits={0} /></td>
                <td><Pct v={r.test.dd} digits={0} /></td>
                <td>{fmtInt(r.test.lost90)} از {fmtInt(e.coins)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="note-list">
        {e.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
      <p className="note">{e.caveat}</p>
    </details>
  );
}

function BacktestTable({ bt }: { bt: FuturesBacktest }) {
  return (
    <div className="table-scroll">
      <table className="t compact" data-testid="fut-backtest">
        <caption>
          روندسوار روی {bt.sym}، از {fdt(bt.from)} تا {fdt(bt.to)}، به ازای هر ۱۰۰۰ تتر
          {bt.fundingAssumedDays > 30 ? `؛ برای ${fmtInt(bt.fundingAssumedDays)} روز فاندینگ بایگانی نبود و ۰٫۰۱٪ هر ۸ ساعت فرض شد` : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col">اهرم</th>
            <th scope="col">بازده کل</th>
            <th scope="col">بیشترین افت</th>
            <th scope="col">لیکویید</th>
            <th scope="col">فاندینگ + کارمزد</th>
          </tr>
        </thead>
        <tbody>
          {bt.rows.map((r) => (
            <tr key={r.lev} className={r.ruined ? 'bad-row' : ''}>
              <th scope="row" className="num">{fmtInt(r.lev)}×</th>
              <td>{r.ruined ? <span className="state-pill bad">صفر شد</span> : <Pct v={r.returnPct} digits={0} />}</td>
              <td><Pct v={r.maxDrawdownPct} digits={0} /></td>
              <td className="num">{fmtInt(r.liquidations)}</td>
              <td className="num">{usdt(r.fundingPaid + r.feesPaid, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FuturesView() {
  const { notify } = useNotify();
  const { snap } = useSnapshot();
  const { data: picks } = usePicks();
  const usdtToman = snap?.live.items.find((i) => i.key === 'usdt')?.price ?? null;
  const [sym, setSym] = useState('BTC');
  const [side, setSide] = useState<Side>('long');
  const [lev, setLev] = useState(3);
  const [margin, setMargin] = useState('100');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [btMode, setBtMode] = useState<'long' | 'longshort'>('long');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [acct, setAcct] = useState<FuturesAccount | null>(null);
  const [cap, setCap] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoLev, setAutoLev] = useState('1');
  const [autoMode, setAutoMode] = useState<'long' | 'longshort'>('long');

  useEffect(() => setAcct(loadFutures()), []);

  useEffect(() => {
    let off = false;
    setMetaErr(null);
    fetch(api(`/api/futures?sym=${sym}&mode=${btMode}&backtest=1`))
      .then((r) => r.json())
      .then((j: Meta) => {
        if (j.error) throw new Error(j.error);
        if (off) return;
        setMeta(j);
        setLev((l) => Math.min(l, j.maxLeverage));
      })
      .catch((e) => !off && setMetaErr(e instanceof Error ? e.message : String(e)));
    return () => {
      off = true;
    };
  }, [sym, btMode]);

  const run = useCallback(async (req: FutAction) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await callFutures(req.action === 'create' ? null : acct, req);
      setAcct(r.account);
      r.newFills.forEach((f: FuturesFill) => {
        const n = futFillNote(f);
        notify(n.title, n.body, 'trade', '/futures', true);
      });
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [acct, notify]);

  // bring the account up to date when the page opens (AppStartup does the same in the app)
  useEffect(() => {
    if (acct && (acct.positions.length || acct.auto) && Date.now() - acct.lastTickAt >= FUT_TICK_MS) void run({ action: 'tick' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct?.id]);

  const price = meta?.sym === sym ? meta.price : null;
  const m = numIn(margin);
  const calc = useMemo(() => {
    if (!price || !(m > 0) || !meta) return null;
    const notional = m * lev;
    const qty = notional / price;
    const liq = liqPrice(side, price, lev, meta.mmr);
    const fees = notional * meta.takerFee * 2;
    const fundDay = notional * meta.funding.rate * 3 * (side === 'long' ? 1 : -1);
    const at = (p: number) => {
      const pnl = (side === 'long' ? 1 : -1) * qty * (p - price) - fees;
      return { pnl, roe: (pnl / m) * 100 };
    };
    const tpN = numIn(tp), slN = numIn(sl);
    return {
      notional, qty, liq, fees, fundDay,
      liqDist: liq ? Math.abs(liq / price - 1) * 100 : null,
      tp: tpN > 0 ? at(tpN) : null,
      sl: slN > 0 ? at(slN) : null,
      slBeyondLiq: slN > 0 && liq !== null && (side === 'long' ? slN <= liq : slN >= liq),
      move1: at(price * (side === 'long' ? 1.01 : 0.99)),
    };
  }, [price, m, lev, side, tp, sl, meta]);

  const marks = acct?.marks ?? {};
  const eq = acct ? equityOf(acct) : 0;
  // toman at Abantether's USDT sell price — what the tether would bring there (rule 102)
  const [basis, setBasis] = useState<AbanBasis | null>(null);
  useEffect(() => {
    setBasis(cachedBasis());
    void currentBasis()
      .then((b) => setBasis(b))
      .catch(() => undefined);
  }, []);
  const coinsOpts = (meta?.coins ?? [{ sym: 'BTC', name: 'Bitcoin', maxLeverage: 125 }]).map((c) => ({ key: c.sym, label: `${c.sym} — ${c.name}` }));
  const autoCoins = (picks?.picked ?? []).map((r) => r.sym);

  return (
    <div className="wrap">
      <PageHead title="فیوچرز (اهرم)">
        معامله قرارداد دائمی با اهرم، کاغذی و روی قیمت واقعی: لیکویید با همان فرمول صرافی، فاندینگ هر ۸ ساعت و کارمزد هر طرف. هیچ سفارشی به صرافی نمی‌رود.
      </PageHead>

      <section className="panel pad warn-box" role="note">
        <b>اهرم بالا یعنی صفر شدن حساب با یک نوسان عادی.</b> با ۱۰۰× یک حرکت ۰٫۶٪ خلاف جهت کل وجه تضمین را می‌برد و روی داده واقعی، روندسوار با ۲۰× و بیشتر در همه ارزها حساب را
        صفر کرد. اعداد زیر را قبل از هر تصمیمی ببینید.
      </section>

      {meta ? <Evidence e={meta.evidence} /> : null}

      <p className="muted small" data-testid="fut-basis">
        آبان‌تتر قرارداد آتی (فیوچرز) ندارد؛ این حساب روی قیمت جهانی همان ارزهاست — همان قیمتی که آبان‌تتر هم قیمت تومانی‌اش را از آن می‌سازد.
        {basis ? ` معادل تومانی با قیمت فروش تتر آبان‌تتر (${fmtInt(basis.usdtSell)} تومان) حساب می‌شود.` : ''}
      </p>

      <section className="panel pad ticket" data-testid="fut-calc">
        <h2>ماشین‌حساب و سفارش</h2>
        <div className="ticket-grid">
          <label className="select">
            <span>ارز</span>
            <select value={sym} onChange={(e) => setSym(e.target.value)} data-testid="fut-sym">
              {coinsOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <div>
            <span className="field-label">جهت</span>
            <Chips label="جهت" value={side} onChange={setSide} options={[{ key: 'long', label: 'خرید (لانگ)' }, { key: 'short', label: 'فروش (شورت)' }]} />
          </div>
          <div className="span2">
            <span className="field-label">اهرم (حداکثر {fmtInt(meta?.maxLeverage ?? 125)}× برای {sym})</span>
            <Chips label="اهرم" value={String(lev)} onChange={(v) => setLev(Number(v))} options={(meta?.leverages ?? [1, 2, 3, 5, 10, 20]).map((l) => ({ key: String(l), label: `${fmtInt(l)}×` }))} />
          </div>
          <label className="field">
            <span className="field-label">وجه تضمین (تتر)</span>
            <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} data-testid="fut-margin" />
            {usdtToman && m > 0 ? <small className="muted money">حدود {fmtInt(Math.round((m * usdtToman) / 1e6))} میلیون تومان</small> : null}
          </label>
          <div>
            <span className="field-label">قیمت لحظه‌ای</span>
            <p className="num big-num" data-testid="fut-price">{px(price)}</p>
            {meta?.sym === sym ? (
              <small className="muted">
                فاندینگ {meta.funding.via === 'okx' ? 'فعلی' : 'فرضی'}: <Pct v={meta.funding.rate * 100} digits={4} /> هر ۸ ساعت
              </small>
            ) : null}
          </div>
          <label className="field">
            <span className="field-label">حد سود (اختیاری)</span>
            <input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder={price ? px(price * (side === 'long' ? 1.05 : 0.95)) : ''} />
          </label>
          <label className="field">
            <span className="field-label">حد ضرر (اختیاری)</span>
            <input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder={price ? px(price * (side === 'long' ? 0.97 : 1.03)) : ''} />
          </label>
        </div>
        {metaErr ? <p className="empty">{metaErr}</p> : null}
        {calc ? (
          <dl className="metrics calc" data-testid="fut-calc-out">
            <div>
              <dt>ارزش قرارداد</dt>
              <dd className="num">{usdt(calc.notional, 0)} <small>تتر</small></dd>
            </div>
            <div>
              <dt>قیمت لیکویید</dt>
              <dd className="num down" data-testid="fut-liq">{calc.liq ? px(calc.liq) : 'ندارد'}</dd>
            </div>
            <div>
              <dt>فاصله تا لیکویید</dt>
              <dd className="num">{calc.liqDist !== null ? `${calc.liqDist.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪` : '—'}</dd>
            </div>
            <div>
              <dt>هر ۱٪ حرکت به نفع شما</dt>
              <dd><Pct v={calc.move1.roe} digits={1} /> <small className="muted">از وجه تضمین</small></dd>
            </div>
            <div>
              <dt>کارمزد باز و بسته</dt>
              <dd className="num">{usdt(calc.fees)} <small>تتر</small></dd>
            </div>
            <div>
              <dt>فاندینگ روزانه با نرخ فعلی</dt>
              <dd className="num">{calc.fundDay >= 0 ? `می‌پردازید ${usdt(calc.fundDay)}` : `می‌گیرید ${usdt(-calc.fundDay)}`} <small>تتر</small></dd>
            </div>
            {calc.tp ? (
              <div>
                <dt>در حد سود</dt>
                <dd><span className="num">{usdt(calc.tp.pnl)}</span> <Pct v={calc.tp.roe} digits={0} /></dd>
              </div>
            ) : null}
            {calc.sl ? (
              <div>
                <dt>در حد ضرر</dt>
                <dd><span className="num">{usdt(calc.sl.pnl)}</span> <Pct v={calc.sl.roe} digits={0} /></dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {calc?.slBeyondLiq ? <p className="empty">حد ضرر آن‌طرف قیمت لیکویید است؛ قبل از رسیدن به آن لیکویید می‌شوید.</p> : null}
        {acct ? (
          <button className="btn run" disabled={busy || !calc} onClick={() => void run({ action: 'open', order: { sym, side, lev, margin: m, tp: numIn(tp) || null, sl: numIn(sl) || null } })} data-testid="fut-open">
            {busy ? 'در حال ثبت…' : `باز کردن ${side === 'long' ? 'لانگ' : 'شورت'} ${fmtInt(lev)}× در حساب کاغذی`}
          </button>
        ) : (
          <p className="muted small">برای ثبت سفارش، پایین‌تر حساب کاغذی بسازید.</p>
        )}
      </section>

      <section className="panel pad" data-testid="fut-account">
        <h2>حساب کاغذی من</h2>
        {!acct ? (
          <>
            <p className="lede">حساب فقط روی همین دستگاه ذخیره می‌شود. موقعیت‌ها هر بار که اپ باز شود (یا «بررسی» را بزنید) با کندل‌های ساعتی واقعیِ فاصله‌ها جلو می‌روند — اگر وسطش لیکویید شده بودید، همان ثبت می‌شود.</p>
            <Chips label="سرمایه" value={cap} onChange={setCap} options={[{ key: '100', label: '۱۰۰ تتر' }, { key: '1000', label: '۱٬۰۰۰ تتر' }, { key: '10000', label: '۱۰٬۰۰۰ تتر' }]} />
            <button className="btn run" disabled={busy} onClick={() => void run({ action: 'create', capital: Number(cap) })} data-testid="fut-create">ساختن حساب کاغذی</button>
          </>
        ) : (
          <>
            <dl className="metrics">
              <div>
                <dt>ارزش حساب</dt>
                <dd className="num" data-testid="fut-equity">{usdt(eq)} <small>تتر</small></dd>
                {basis ? (
                  <dd className="fin-money small" data-testid="fut-equity-toman">
                    ≈ {fmtInt(eq * basis.usdtSell)} تومان
                  </dd>
                ) : null}
              </div>
              <div>
                <dt>بازده</dt>
                <dd><Pct v={(eq / acct.startCapital - 1) * 100} digits={1} /></dd>
              </div>
              <div>
                <dt>آزاد</dt>
                <dd className="num">{usdt(acct.wallet)}</dd>
              </div>
              <div>
                <dt>آخرین بررسی</dt>
                <dd>{fdt(acct.lastTickAt)}</dd>
              </div>
            </dl>

            {acct.positions.length ? (
              <div className="table-scroll">
                <table className="t compact" data-testid="fut-positions">
                  <thead>
                    <tr>
                      <th scope="col">موقعیت</th>
                      <th scope="col">ورود / فعلی</th>
                      <th scope="col">لیکویید</th>
                      <th scope="col">سود/زیان باز</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {acct.positions.map((p) => {
                      const mark = marks[p.sym] ?? p.entry;
                      const u = unrealised(p, mark);
                      const liq = liqPrice(p.side, p.entry, p.lev, p.mmr);
                      return (
                        <tr key={p.id}>
                          <th scope="row">
                            {p.sym} <span className={p.side === 'long' ? 'up' : 'down'}>{p.side === 'long' ? 'لانگ' : 'شورت'}</span> <span className="num">{fmtInt(p.lev)}×</span>
                            {p.auto ? <small className="muted"> (روندسوار)</small> : null}
                          </th>
                          <td className="num">{px(p.entry)}<br />{px(mark)}</td>
                          <td className="num down">{liq ? px(liq) : '—'}</td>
                          <td><span className="num">{usdt(u)}</span> <Pct v={(u / Math.max(1e-9, p.margin)) * 100} digits={0} /></td>
                          <td><button className="btn small-btn" disabled={busy} onClick={() => void run({ action: 'close', posId: p.id })}>بستن</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>موقعیت بازی ندارید.</Empty>
            )}

            <div className="admin">
              <button className="btn run" disabled={busy} onClick={() => void run({ action: 'tick' })} data-testid="fut-tick">{busy ? 'در حال بررسی…' : 'بررسی همین حالا'}</button>
              <button className="btn run danger" disabled={busy} onClick={() => { if (confirm('حساب کاغذی و همه موقعیت‌هایش پاک شود؟')) { saveFutures(null); setAcct(null); } }}>پاک کردن حساب</button>
            </div>

            <div className="sub-panel" data-testid="fut-auto">
              <h3>روندسوار با اهرم (خودکار)</h3>
              <p className="muted small">
                هر روز ساعت ۳:۳۰ بامداد تهران (بسته شدن روز جهانی): وقتی ارز و بیت‌کوین بالای میانگین ۵۰ روزه‌اند می‌خرد، وگرنه می‌بندد. اندازه موقعیت با نوسان کوچک می‌شود. پیش‌فرض ۱× و
                فقط خرید است — همان که روی داده واقعی کمترین ریسک را داشت.
              </p>
              {acct.auto ? (
                <>
                  <p>روشن: {acct.auto.coins.join('، ')} با <span className="num">{fmtInt(acct.auto.lev)}×</span>، {acct.auto.mode === 'long' ? 'فقط خرید' : 'خرید و فروش'}.</p>
                  <div className="admin">
                    <button className="btn run" disabled={busy} onClick={() => void run({ action: 'autoNow' })}>تصمیم امروز همین حالا</button>
                    <button className="btn run danger" disabled={busy} onClick={() => void run({ action: 'auto', auto: null })}>خاموش کردن</button>
                  </div>
                </>
              ) : (
                <>
                  <span className="field-label">اهرم</span>
                  <Chips label="اهرم روندسوار" value={autoLev} onChange={setAutoLev} options={['1', '2', '3', '5'].map((k) => ({ key: k, label: `${fmtInt(Number(k))}×` }))} />
                  <Chips label="جهت" value={autoMode} onChange={setAutoMode} options={[{ key: 'long', label: 'فقط خرید' }, { key: 'longshort', label: 'خرید و فروش' }]} />
                  <p className="muted small">ارزها: {autoCoins.length ? autoCoins.join('، ') : '…'} (ارزهای پیشنهادی صفحه نوسان‌گیری)</p>
                  {Number(autoLev) >= 3 ? <p className="empty">با {fmtInt(Number(autoLev))}× در آزمون ۲۰۲۳–۲۰۲۶ از هر ۸ ارز {Number(autoLev) >= 5 ? '۴' : '۲'} تا بیش از ۹۰٪ سرمایه را از دست دادند.</p> : null}
                  <button className="btn run" disabled={busy || !autoCoins.length} onClick={() => void run({ action: 'auto', auto: { coins: autoCoins, lev: Number(autoLev), mode: autoMode } })} data-testid="fut-auto-on">روشن کردن</button>
                </>
              )}
            </div>

            {acct.fills.length ? (
              <div className="table-scroll">
                <table className="t compact" data-testid="fut-fills">
                  <caption>معاملات بسته‌شده</caption>
                  <thead>
                    <tr>
                      <th scope="col">موقعیت</th>
                      <th scope="col">دلیل</th>
                      <th scope="col">سود/زیان</th>
                      <th scope="col">فاندینگ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...acct.fills].reverse().slice(0, 15).map((f) => (
                      <tr key={f.id + f.closedAt} className={f.reason === 'liquidation' ? 'bad-row' : ''}>
                        <th scope="row">{f.sym} {f.side === 'long' ? 'لانگ' : 'شورت'} <span className="num">{fmtInt(f.lev)}×</span></th>
                        <td>{({ tp: 'حد سود', sl: 'حد ضرر', liquidation: 'لیکویید', manual: 'دستی', signal: 'سیگنال', end: 'پایان' } as const)[f.reason]}</td>
                        <td><span className="num">{usdt(f.pnl)}</span> <Pct v={f.roePct} digits={0} /></td>
                        <td className="num">{usdt(-f.funding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <ul className="event-list">
              {acct.events.slice(0, 6).map((e, i) => (
                <li className="event-row" key={i}>
                  <span className="event-when">{fdt(e.at)}</span>
                  <span className="event-text">{e.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {err ? <p className="empty" role="alert">{err}</p> : null}
      </section>

      <section className="panel pad" data-testid="fut-bt">
        <h2>هر اهرم روی {sym} چه کرد؟</h2>
        <Chips label="جهت روندسوار" value={btMode} onChange={setBtMode} options={[{ key: 'long', label: 'فقط خرید' }, { key: 'longshort', label: 'خرید و فروش' }]} />
        {!meta || meta.sym !== sym ? <div className="skeleton picks-skel" /> : meta.backtest && 'rows' in meta.backtest ? <BacktestTable bt={meta.backtest} /> : <p className="empty">{meta.backtest?.error ?? 'بک‌تست در دسترس نیست.'}</p>}
        <p className="muted small">کل حساب وجه تضمین است (یعنی اهرم ۱۰× یعنی موقعیتی ۹ برابر سرمایه)؛ گذشته وعده آینده نیست.</p>
      </section>
    </div>
  );
}
