'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmtInt, fmtNum, fmtPct, fmtPrice, isNum, num } from '@/lib/num';
import { PROFILES, SIM_ASSETS, type SimAsset, type SimProfile, type SimTrade, type TradeKind } from '@/lib/engine/simulator';
import type { Coverage, SimResponse } from '@/lib/simulate';
import { Chips, MultiChips, PageHead, Pct, Select, Toggle } from '../ui';
import type { EquityLine } from '../EquityChart';

const EquityChart = dynamic(() => import('../EquityChart'), { ssr: false, loading: () => <div className="chart-host equity-host skeleton" /> });

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const faDate = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
const faShort = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
const faYear = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

function tomanWords(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} میلیارد تومان`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون تومان`;
  return `${sign}${fmtInt(a)} تومان`;
}

const KIND: Record<TradeKind, string> = { entry: 'ورود', add: 'افزایش', trim: 'کاهش', exit: 'خروج', stop: 'حد ضرر', take_profit: 'سیو سود' };
const META = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<SimAsset, (typeof SIM_ASSETS)[number]>;
const PRESETS = [
  { key: '1m', label: '۱ ماه', days: 30 },
  { key: '3m', label: '۳ ماه', days: 91 },
  { key: '6m', label: '۶ ماه', days: 182 },
  { key: '1y', label: '۱ سال', days: 365 },
] as const;
const CAPITALS = [100_000_000, 500_000_000, 1_000_000_000, 5_000_000_000];

function unitPrice(t: SimTrade) {
  if (t.asset === 'tse') return `شاخص ${fmtInt(t.price)}`;
  return `${fmtPrice(t.price / 10)} تومان برای هر ${META[t.asset].unit}`;
}
function qtyText(t: SimTrade) {
  if (t.asset === 'tse') return null;
  const digits = t.asset === 'btc' || t.asset === 'eth' ? 4 : t.asset === 'g18' ? 1 : t.asset === 'usd' ? 0 : 1;
  return `${fmtNum(t.qty, digits)} ${META[t.asset].unit}`;
}

function TradeEntry({ t }: { t: SimTrade }) {
  const qty = qtyText(t);
  return (
    <li className={`entry ${t.side}`} id={`trade-${t.n}`}>
      <div className="entry-when">
        <span className="entry-n num">{fmtInt(t.n)}</span>
        <span className="entry-day">{faShort(t.date)}</span>
        <small>{faYear(t.date)}</small>
      </div>
      <div className="entry-body">
        <p className="entry-line">
          <span className={`act ${t.side}`}>{t.side === 'buy' ? 'خرید' : 'فروش'}</span>
          <strong>{META[t.asset].label}</strong>
          <span className="tag">{KIND[t.kind]}</span>
          <span className="entry-amt num">{tomanWords(t.valueToman)}</span>
        </p>
        <p className="entry-sub">
          {qty ? <>{qty}، </> : null}
          {unitPrice(t)}، کارمزد {tomanWords(t.feeToman)}، وزن پس از معامله {fmtPct(t.weightAfter * 100, 0, false)}
          {isNum(t.realizedToman) ? (
            <>
              ، نتیجه <b className={t.realizedToman >= 0 ? 'up' : 'down'}>{tomanWords(t.realizedToman)} ({fmtPct(t.realizedPct, 1)})</b>
              {isNum(t.holdDays) ? ` پس از ${fmtInt(t.holdDays)} روز` : ''}
            </>
          ) : null}
        </p>
        <details className="why" open={t.kind === 'stop' || t.news.length > 0}>
          <summary>
            دلیل تصمیم <span className="muted small">(تصمیم {faShort(t.decisionDate)}، امتیاز {fmtInt(t.score)}{t.newsScore ? `، سهم اخبار ${fmtInt(t.newsScore)}` : ''})</span>
          </summary>
          <ul>
            {t.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {t.news.length ? (
            <ul className="cites" aria-label="خبرهای مؤثر در این تصمیم">
              {t.news.map((n) => (
                <li key={n.id}>
                  <span className={`fx ${n.effect >= 0 ? 'up' : 'down'}`} aria-hidden="true">{n.effect >= 0 ? '▲' : '▼'}</span>
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noreferrer">
                      {n.title}
                    </a>
                  ) : (
                    n.title
                  )}
                  <small>
                    {n.source}، {faShort(n.date)}: {n.facts.join('، ')}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </div>
    </li>
  );
}

export default function SimulatorView() {
  const [cov, setCov] = useState<Coverage | null>(null);
  const [covErr, setCovErr] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capital, setCapital] = useState('500000000');
  const [profile, setProfile] = useState<SimProfile>('balanced');
  const [assets, setAssets] = useState<SimAsset[]>(['usd', 'g18', 'coin', 'tse', 'btc']);
  const [useNews, setUseNews] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SimResponse | null>(null);
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell' | 'news'>('all');
  const [assetFilter, setAssetFilter] = useState<'all' | SimAsset>('all');
  const [showBench, setShowBench] = useState({ deposit: true, usd: true, equal: false });

  useEffect(() => {
    fetch('/api/simulate')
      .then((r) => r.json())
      .then((c: Coverage & { error?: string }) => {
        if (c.error) throw new Error(c.error);
        setCov(c);
        const e = c.latestEnd ?? c.today;
        setEnd(e);
        const s = addDays(e, -182);
        setStart(c.earliestStart && s < c.earliestStart ? c.earliestStart : s);
      })
      .catch((e) => {
        setCovErr(e instanceof Error ? e.message : String(e));
        const today = new Date().toISOString().slice(0, 10);
        setEnd(today);
        setStart(addDays(today, -182));
      });
  }, []);

  const capitalNum = num(capital);
  const preset = (days: number) => {
    const e = cov?.latestEnd ?? end;
    if (!e) return;
    setEnd(e);
    const s = addDays(e, -days);
    setStart(cov?.earliestStart && s < cov.earliestStart ? cov.earliestStart : s);
  };

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end, capitalToman: capitalNum, profile, assets, useNews }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      setRes(j);
      setSideFilter('all');
      setAssetFilter('all');
      requestAnimationFrame(() => document.getElementById('sim-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'شبیه‌سازی انجام نشد.');
    } finally {
      setBusy(false);
    }
  }

  const lines = useMemo<EquityLine[]>(() => {
    if (!res) return [];
    const L: EquityLine[] = [{ key: 'strategy', label: 'معامله‌گر', color: '#1A2848', width: 3, points: res.equity.map((e) => ({ date: e.date, value: e.equity })) }];
    if (showBench.deposit) L.push({ key: 'deposit', label: 'سپرده', color: '#8A94A6', dashed: true, width: 2, points: res.equity.map((e) => ({ date: e.date, value: e.deposit })) });
    if (showBench.usd) L.push({ key: 'usd', label: 'دلار', color: '#0D7377', width: 2, points: res.equity.filter((e) => isNum(e.usdHold)).map((e) => ({ date: e.date, value: e.usdHold! })) });
    if (showBench.equal) L.push({ key: 'equal', label: 'تقسیم برابر', color: '#B07D1A', width: 1, points: res.equity.filter((e) => isNum(e.equal)).map((e) => ({ date: e.date, value: e.equal! })) });
    return L;
  }, [res, showBench]);
  const markers = useMemo(() => (res ? res.trades.map((t) => ({ date: t.date, side: t.side, text: '' })) : []), [res]);

  const visibleTrades = useMemo(() => {
    if (!res) return [];
    return res.trades.filter((t) => (assetFilter === 'all' || t.asset === assetFilter) && (sideFilter === 'all' || (sideFilter === 'news' ? t.news.length > 0 : t.side === sideFilter)));
  }, [res, sideFilter, assetFilter]);

  const m = res?.metrics;
  const coverageNote = cov?.assets.filter((a) => assets.includes(a.key) && a.points < 70);

  return (
    <div className="wrap">
      <PageHead title="معامله‌گر شبیه‌ساز">
        یک بازه زمانی از گذشته و سرمایه اولیه بدهید. معامله‌گر روز به روز جلو می‌رود، فقط قیمت‌ها و خبرهایی را می‌بیند که تا همان روز منتشر شده بود، خرید و فروش می‌کند و دلیل هر تصمیم را ثبت می‌کند.
      </PageHead>

      <section className="panel pad ticket" aria-labelledby="ticket-h">
        <h2 id="ticket-h">شرایط شبیه‌سازی</h2>
        <div className="ticket-grid">
          <fieldset className="field">
            <legend>بازه زمانی</legend>
            <div className="date-pair">
              <label>
                <span>از</span>
                <input type="date" value={start} min={cov?.earliestStart ?? undefined} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
                <small>{start ? faDate(start) : '—'}</small>
              </label>
              <label>
                <span>تا</span>
                <input type="date" value={end} min={start || undefined} max={cov?.latestEnd ?? undefined} onChange={(e) => setEnd(e.target.value)} />
                <small>{end ? faDate(end) : '—'}</small>
              </label>
            </div>
            <div className="chips" role="group" aria-label="بازه‌های آماده">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => preset(p.days)}>
                  {p.label} اخیر
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>سرمایه اولیه</legend>
            <label className="amount wide">
              <input inputMode="numeric" value={capital} onChange={(e) => setCapital(e.target.value.replace(/[^\d۰-۹٠-٩]/g, ''))} aria-describedby="cap-words" />
              <span>تومان</span>
            </label>
            <small id="cap-words" className="muted">{isNum(capitalNum) && capitalNum > 0 ? tomanWords(capitalNum) : 'عدد را به تومان وارد کنید'}</small>
            <div className="chips" role="group" aria-label="مبلغ‌های آماده">
              {CAPITALS.map((c) => (
                <button key={c} type="button" aria-pressed={capitalNum === c} onClick={() => setCapital(String(c))}>
                  {tomanWords(c).replace(' تومان', '')}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>ریسک‌پذیری</legend>
            <Chips label="پروفایل ریسک" value={profile} onChange={setProfile} options={(Object.keys(PROFILES) as SimProfile[]).map((k) => ({ key: k, label: PROFILES[k].label }))} />
            <small className="muted">
              سقف هر دارایی {fmtPct(PROFILES[profile].maxW * 100, 0, false)}، سقف کریپتو {fmtPct(PROFILES[profile].cryptoCap * 100, 0, false)}، حداقل نقد {fmtPct(PROFILES[profile].cashFloor * 100, 0, false)}
            </small>
          </fieldset>

          <fieldset className="field">
            <legend>بازارهای مجاز</legend>
            <MultiChips label="دارایی‌های مجاز" value={assets} onChange={setAssets} options={SIM_ASSETS.map((a) => ({ key: a.key, label: a.label }))} />
            {coverageNote?.length ? <small className="down">تاریخچه کافی ندارد: {coverageNote.map((a) => a.label).join('، ')}</small> : null}
          </fieldset>
        </div>

        <div className="ticket-foot">
          <Toggle checked={useNews} onChange={setUseNews}>
            استفاده از اخبار برای تصمیم‌های فاندامنتال
          </Toggle>
          <button className="btn run" onClick={run} disabled={busy || !start || !end || !isNum(capitalNum)}>
            {busy ? 'در حال معامله…' : 'شروع شبیه‌سازی'}
          </button>
        </div>
        {busy ? (
          <p className="banner info" role="status">
            تاریخچه قیمت‌ها{useNews ? ' و خبرهای هر ماه' : ''} در حال دریافت است. اجرای اول برای بازه یک‌ساله ممکن است تا یک دقیقه طول بکشد؛ اجراهای بعدی از حافظه سریع‌ترند.
          </p>
        ) : null}
        {err ? (
          <p className="banner warn" role="alert">
            {err}
          </p>
        ) : null}
        {covErr ? <p className="note">بازه در دسترس دریافت نشد ({covErr})؛ می‌توانید تاریخ را دستی انتخاب کنید.</p> : null}
      </section>

      {res && m ? (
        <div id="sim-result" className="sim-result">
          <section className="statement" aria-label="خلاصه نتیجه">
            <p className="statement-range">
              {faDate(res.input.start)} تا {faDate(res.input.end)}، پروفایل {PROFILES[res.input.profile].label}
              {res.cached ? '، از حافظه' : ''}
            </p>
            <div className="statement-main">
              <div>
                <span className="statement-label">ارزش پایانی سرمایه</span>
                <strong className="statement-final num">{tomanWords(m.finalEquity)}</strong>
              </div>
              <div className={`statement-pnl ${m.pnlToman >= 0 ? 'up' : 'down'}`}>
                <span className="statement-label">{m.pnlToman >= 0 ? 'سود' : 'زیان'}</span>
                <strong className="num">
                  {tomanWords(Math.abs(m.pnlToman))} <span dir="ltr">{fmtPct(m.returnPct, 1)}</span>
                </strong>
              </div>
            </div>
            <dl className="statement-stats">
              <div>
                <dt>بازده سالانه‌شده</dt>
                <dd>{isNum(m.annualizedPct) ? fmtPct(m.annualizedPct, 0) : '—'}</dd>
              </div>
              <div>
                <dt>بازده به دلار</dt>
                <dd>{fmtPct(m.usdReturnPct, 1)}</dd>
              </div>
              <div>
                <dt>بیشترین افت</dt>
                <dd>{fmtPct(m.maxDrawdownPct, 1)}</dd>
              </div>
              <div>
                <dt>معاملات</dt>
                <dd>
                  {fmtInt(m.trades)}
                  {isNum(m.winRatePct) ? <small> (برد {fmtPct(m.winRatePct, 0, false)})</small> : null}
                </dd>
              </div>
              <div>
                <dt>کارمزد و اسپرد</dt>
                <dd>{tomanWords(m.feesToman)}</dd>
              </div>
              <div>
                <dt>سود نقدینگی</dt>
                <dd>{tomanWords(m.interestToman)}</dd>
              </div>
            </dl>
          </section>

          {res.warnings.length ? (
            <ul className="banner sim-warn">
              {res.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <section className="panel pad">
            <div className="section-head">
              <h2>ارزش سرمایه روز به روز</h2>
              <div className="bench-toggles">
                <Toggle checked={showBench.deposit} onChange={(v) => setShowBench((s) => ({ ...s, deposit: v }))}>
                  <i className="key k-deposit" aria-hidden="true" /> سپرده
                </Toggle>
                <Toggle checked={showBench.usd} onChange={(v) => setShowBench((s) => ({ ...s, usd: v }))}>
                  <i className="key k-usd" aria-hidden="true" /> دلار
                </Toggle>
                <Toggle checked={showBench.equal} onChange={(v) => setShowBench((s) => ({ ...s, equal: v }))}>
                  <i className="key k-equal" aria-hidden="true" /> تقسیم برابر
                </Toggle>
              </div>
            </div>
            <EquityChart lines={lines} markers={markers} />
            <p className="note">
              <i className="key k-strategy" aria-hidden="true" /> خط پررنگ: معامله‌گر. فلش سبز خرید و فلش قرمز فروش است.
            </p>
          </section>

          <section className="analysis" aria-labelledby="analysis-h">
            <h2 id="analysis-h">تحلیل معاملات</h2>
            {res.analysis.map((a) => (
              <div key={a.title} className="analysis-part">
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
            {res.narrative ? (
              <div className="analysis-part narrative">
                <h3>مرور معامله‌گر ارشد</h3>
                {res.narrative.text.split(/\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <small className="muted">نوشته‌شده با {res.narrative.model} فقط بر پایه اعداد و خبرهای همین شبیه‌سازی</small>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="journal-h">
            <div className="section-head">
              <h2 id="journal-h">دفتر معاملات</h2>
              <span className="muted">{fmtInt(visibleTrades.length)} از {fmtInt(res.trades.length)} معامله</span>
            </div>
            <div className="filterbar">
              <Chips
                label="نوع معامله"
                value={sideFilter}
                onChange={setSideFilter}
                options={[
                  { key: 'all', label: 'همه', count: res.trades.length },
                  { key: 'buy', label: 'خرید', count: res.trades.filter((t) => t.side === 'buy').length },
                  { key: 'sell', label: 'فروش', count: res.trades.filter((t) => t.side === 'sell').length },
                  { key: 'news', label: 'متأثر از خبر', count: res.trades.filter((t) => t.news.length).length },
                ]}
              />
              <Select label="دارایی" value={assetFilter} onChange={setAssetFilter} options={[{ key: 'all', label: 'همه دارایی‌ها' }, ...res.input.assets.map((a) => ({ key: a, label: META[a].label }))]} />
            </div>
            {visibleTrades.length ? (
              <ol className="journal">
                {visibleTrades.map((t) => (
                  <TradeEntry key={t.n} t={t} />
                ))}
              </ol>
            ) : (
              <p className="empty">{res.trades.length ? 'معامله‌ای با این فیلتر نیست.' : 'در این بازه هیچ سیگنالی از آستانه ورود عبور نکرد و کل سرمایه در درآمد ثابت ماند.'}</p>
            )}
          </section>

          <div className="split">
            <section className="panel">
              <div className="table-scroll">
                <table className="t">
                  <caption>مقایسه با گزینه‌های منفعل</caption>
                  <thead>
                    <tr>
                      <th scope="col">روش</th>
                      <th scope="col">ارزش پایانی</th>
                      <th scope="col">بازده</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...res.benchmarks].sort((a, b) => b.returnPct - a.returnPct).map((b) => (
                      <tr key={b.key} className={b.key === 'strategy' ? 'me' : undefined}>
                        <th scope="row">{b.label}</th>
                        <td className="num">{tomanWords(b.finalToman)}</td>
                        <td>
                          <Pct v={b.returnPct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <div className="table-scroll">
                <table className="t">
                  <caption>سهم هر دارایی از نتیجه</caption>
                  <thead>
                    <tr>
                      <th scope="col">دارایی</th>
                      <th scope="col">تغییر بازار</th>
                      <th scope="col">سود و زیان</th>
                      <th scope="col">معامله</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.attribution.map((a) => {
                      const total = a.realizedToman + a.unrealizedToman;
                      return (
                        <tr key={a.asset}>
                          <th scope="row" className="sym">
                            {a.label}
                            <small>
                              داده: {a.basis}
                              {a.reconstructed ? ' (بازسازی‌شده)' : ''}
                            </small>
                          </th>
                          <td>
                            <Pct v={a.marketPct} />
                          </td>
                          <td className={`num ${total > 0 ? 'up' : total < 0 ? 'down' : ''}`}>
                            {tomanWords(total)}
                            {a.unrealizedToman ? <small>باز: {tomanWords(a.unrealizedToman)}</small> : null}
                          </td>
                          <td className="num">{fmtInt(a.trades)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {res.news.enabled ? (
            <section className="panel pad news-used" aria-labelledby="news-h">
              <h2 id="news-h">خبرهایی که در تصمیم‌ها اثر داشتند</h2>
              <p className="note">
                {fmtInt(res.news.items)} خبر با اثر قابل‌تشخیص از {res.news.sources.join(' و ') || 'منابع خبری'} خوانده شد
                {res.news.chunksTotal ? ` (${fmtInt(res.news.chunksLoaded)} از ${fmtInt(res.news.chunksTotal)} بخش ماهانه)` : ''}. فهرست زیر فقط خبرهایی است که به یک معامله استناد شده‌اند.
              </p>
              {res.newsUsed.length ? (
                <ul className="cites">
                  {res.newsUsed.slice(0, 40).map((n) => (
                    <li key={n.id}>
                      {n.url ? (
                        <a href={n.url} target="_blank" rel="noreferrer">
                          {n.title}
                        </a>
                      ) : (
                        n.title
                      )}
                      <small>
                        {n.source}، {faDate(n.date)}: {n.facts.join('، ')}؛ معامله {n.usedIn.map((x) => fmtInt(x)).join('، ')}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">هیچ خبری آن‌قدر اثر نداشت که به تصمیمی استناد شود.</p>
              )}
              {res.news.errors.length ? (
                <details className="why">
                  <summary>خطاهای دریافت خبر</summary>
                  <ul>
                    {res.news.errors.map((e) => (
                      <li key={e} className="ltr-text">
                        {e}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <details className="method panel">
        <summary>معامله‌گر چطور تصمیم می‌گیرد</summary>
        <ol>
          <li>هر روز برای هر دارایی امتیازی بین منفی ۱۰۰ و مثبت ۱۰۰ ساخته می‌شود: ساختار روند (میانگین ۲۰ و ۵۰ روزه)، بازده ۲۰ و ۶۰ روزه نسبت به نوسان، RSI برای اشباع خرید، فاصله از سقف اخیر، حباب سکه نسبت به میانگین سه‌ماهه و جمع‌بندی اخبار ۱۰ روز اخیر.</li>
          <li>بازبینی سبد هفته‌ای یک بار انجام می‌شود. اگر خبری با اثر زیاد روی یکی از دارایی‌ها منتشر شود، بازبینی همان روز انجام می‌شود.</li>
          <li>ورود وقتی است که امتیاز از آستانه پروفایل بالاتر برود. اندازه موقعیت با قدرت سیگنال و نوسان دارایی تنظیم می‌شود و سقف هر دارایی، سقف کریپتو و حداقل نقدینگی رعایت می‌شود.</li>
          <li>هر موقعیت حد ضرر متحرک دارد که با نوسان همان دارایی تنظیم می‌شود. بعد از فعال شدن حد ضرر، ۱۰ روز ورود دوباره ممنوع است. وقتی سود به سه برابر فاصله حد ضرر برسد و RSI بالا باشد، یک‌سوم موقعیت فروخته می‌شود.</li>
          <li>تصمیم در پایان جلسه گرفته می‌شود و سفارش در قیمت پایانی جلسه معاملاتی بعدی همان دارایی اجرا می‌شود. فقط خبرهایی دیده می‌شوند که قبل از ساعت ۱۶ همان روز منتشر شده‌اند.</li>
          <li>هزینه هر طرف معامله: {SIM_ASSETS.map((a) => `${a.label} ${fmtPct(a.cost * 100, 1, false)}`).join('، ')}. پول نقد سود درآمد ثابت سالانه می‌گیرد.</li>
          <li>خبرها از جست‌وجوی تاریخ‌دار Google News (و GDELT در صورت خطا) خوانده می‌شوند و با قاعده‌های کلیدواژه‌ای به اثر مثبت یا منفی روی هر دارایی تبدیل می‌شوند؛ گزارش‌های صرف قیمت وزن کمتری از رویدادهای اصلی مثل تحریم، مذاکره یا نرخ بهره دارند.</li>
          <li>قیمت بیت‌کوین و اتریوم به تومان از قیمت جهانی ضرب در دلار آزاد ساخته شده و پرمیوم تتر را در نظر نمی‌گیرد. صندوق شاخصی دقیقاً شاخص کل را دنبال نمی‌کند. خرید کسری از سکه معادل گواهی سپرده سکه در بورس کالا فرض شده است.</li>
        </ol>
      </details>
    </div>
  );
}
