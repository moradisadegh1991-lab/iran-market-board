'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmtDateTimeFa, fmtInt, fmtNum, fmtPct, isNum } from '@/lib/num';
import { SWING_EXIT_LABEL, type SwingResult } from '@/lib/engine/swing';
import type { SwingPortfolio } from '@/lib/engine/swing-portfolio';
import type { SwingScan } from '@/lib/engine/swing-scan';
import type { SwingLiveSession } from '@/lib/engine/swing-live';
import { fmtDateTimeFa as fdt } from '@/lib/num';
import { Chips, Empty, PageHead, Pct, Select } from '../ui';
import { tomanWords } from '../TradeEntry';
import type { EquityLine } from '../EquityChart';

const EquityChart = dynamic(() => import('../EquityChart'), { ssr: false, loading: () => <div className="chart-host equity-host skeleton" /> });

interface Menu {
  coins: { id: string; symbol: string; name: string; meme?: boolean; picked?: boolean }[];
  maxDays: number;
  presets: { key: string; label: string; note: string }[];
  error?: string;
}

const WINDOWS = [
  { key: '30', label: '۱ ماه' },
  { key: '60', label: '۲ ماه' },
  { key: '90', label: '۳ ماه' },
] as const;
const CAPITALS = [100_000_000, 500_000_000, 1_000_000_000];

export default function SwingView() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [coinId, setCoinId] = useState('bitcoin');
  const [coinQuery, setCoinQuery] = useState('');
  const [preset, setPreset] = useState<'calm' | 'normal' | 'aggressive'>('normal');
  const [days, setDays] = useState<'30' | '60' | '90'>('60');
  const [capital, setCapital] = useState('500000000');
  const [feePct, setFeePct] = useState('0.4');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<(SwingResult & { dataVia?: string }) | null>(null);
  const [exitFilter, setExitFilter] = useState<'all' | 'win' | 'loss'>('all');
  type Mode = 'single' | 'multi' | 'auto';
  const [mode, setMode] = useState<Mode>('single');
  const multi = mode === 'multi';
  const auto = mode === 'auto';
  const [basket, setBasket] = useState<string[]>([]);
  const [pf, setPf] = useState<SwingPortfolio | null>(null);
  const [scan, setScan] = useState<SwingScan | null>(null);
  const [autoCount, setAutoCount] = useState<'3' | '4' | '6'>('4');
  const [live, setLive] = useState<SwingLiveSession | null>(null);
  const [liveHours, setLiveHours] = useState('24');
  const [secret, setSecret] = useState('');
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);

  const loadLive = useCallback(() => {
    fetch('/api/swing-live', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setLive(j.active ?? null))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadLive();
    const id = setInterval(loadLive, 30_000);
    return () => clearInterval(id);
  }, [loadLive]);

  async function liveAction(action: 'start' | 'stop') {
    setLiveBusy(true);
    setLiveErr(null);
    try {
      const body: any = { action, ...(action === 'start' ? {
        coins: basket.map((id) => { const c = menu?.coins.find((x) => x.id === id); return { id, symbol: c?.symbol, name: c?.name }; }),
        capitalToman: Number(capital), hours: Number(liveHours), preset, feePct: Number(feePct),
      } : {}) };
      const r = await fetch('/api/swing-live', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      loadLive();
    } catch (e) {
      setLiveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveBusy(false);
    }
  }
  const MAX_BASKET = 8;

  function toggleCoin(id: string) {
    setBasket((b) => (b.includes(id) ? b.filter((x) => x !== id) : b.length >= MAX_BASKET ? b : [...b, id]));
  }

  useEffect(() => {
    fetch('/api/swing')
      .then((r) => r.json())
      .then((m: Menu) => {
        if (m.error) throw new Error(m.error);
        setMenu(m);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const shownCoins = useMemo(() => {
    const all = menu?.coins ?? [];
    const q = coinQuery.trim().toLowerCase();
    if (!q) return all.slice(0, 120);
    const hit = all.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.id.includes(q));
    // the selected coin must stay in the list, otherwise the select would silently show nothing
    const sel = all.find((c) => c.id === coinId);
    return sel && !hit.some((c) => c.id === coinId) ? [sel, ...hit] : hit;
  }, [menu, coinQuery, coinId]);

  const coin = menu?.coins.find((c) => c.id === coinId);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const common = { days: Number(days), capitalToman: Number(capital), preset, feePct: Number(feePct) };
      const payload = auto
        ? { ...common, auto: true, count: Number(autoCount) }
        : multi
          ? { ...common, coins: basket.map((id) => { const c = menu?.coins.find((x) => x.id === id); return { id, symbol: c?.symbol, name: c?.name }; }) }
          : { ...common, coinId, symbol: coin?.symbol, name: coin?.name };
      const r = await fetch('/api/swing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      if (auto) { setScan(j.scan); setPf(j.portfolio); setRes(null); }
      else if (multi) { setPf(j.portfolio); setScan(null); setRes(null); }
      else { setRes(j); setPf(null); setScan(null); }
      setExitFilter('all');
      requestAnimationFrame(() => document.getElementById('swing-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const lines: EquityLine[] = useMemo(() => {
    if (!res) return [];
    return [{ key: 'swing', label: 'ارزش سرمایه', color: 'var(--teal)', width: 2, points: res.equity.map((p) => ({ date: new Date(p.t).toISOString().slice(0, 10), value: p.equity, t: p.t })) }];
  }, [res]);
  const markers = useMemo(
    () =>
      (res?.trades ?? []).flatMap((t) => [
        { date: new Date(t.entryAt).toISOString().slice(0, 10), side: 'buy' as const, text: 'خرید', at: t.entryAt },
        { date: new Date(t.exitAt).toISOString().slice(0, 10), side: 'sell' as const, text: SWING_EXIT_LABEL[t.exit], at: t.exitAt },
      ]),
    [res],
  );
  const shownTrades = (res?.trades ?? []).filter((t) => (exitFilter === 'all' ? true : exitFilter === 'win' ? t.pnlToman > 0 : t.pnlToman <= 0));
  const m = res?.metrics;
  const beatHold = m ? m.returnPct - m.buyHoldPct : null;

  return (
    <div className="wrap">
      <PageHead title="نوسان‌گیری کریپتو">
        روی کندل‌های ساعتی یک ارز، استراتژی نوسان‌گیری را آزمایش می‌کند: خرید در اصلاح یا شکست سقف کوتاه‌مدت، فروش با رسیدن به هدف، حد ضرر، شکستن روند یا پایان مهلت. هر معامله
        کارمزد و اسپرد دو طرف را می‌پردازد و نتیجه با «خرید و نگه‌داری» همان ارز مقایسه می‌شود.
      </PageHead>

      {live && live.status === 'running' ? (
        <section className="panel pad live-swing">
          <div className="live-status-top">
            <span className="state-pill ok">نوسان‌گیری برخط در حال اجرا</span>
            <span className="muted">{live.config.coins.map((c) => c.symbol).join('، ')} · کندل {fmtInt(live.barMinutes)} دقیقه‌ای</span>
          </div>
          <dl className="metrics">
            <div>
              <dt>ارزش کنونی</dt>
              <dd className="num">{tomanWords(live.equity[live.equity.length - 1]?.equity ?? live.config.capitalToman)}</dd>
            </div>
            <div>
              <dt>بازده</dt>
              <dd><Pct v={((live.equity[live.equity.length - 1]?.equity ?? live.config.capitalToman) / live.config.capitalToman - 1) * 100} digits={2} /></dd>
            </div>
            <div>
              <dt>معاملات بسته‌شده</dt>
              <dd className="num">{fmtInt(live.fills.length)}</dd>
            </div>
            <div>
              <dt>موقعیت باز</dt>
              <dd className="num">{fmtInt(live.open.length)}</dd>
            </div>
            <div>
              <dt>پایان</dt>
              <dd>{fdt(live.endsAt)}</dd>
            </div>
            <div>
              <dt>آخرین بررسی</dt>
              <dd>{fdt(live.lastTickAt)}</dd>
            </div>
          </dl>

          {live.open.length ? (
            <div className="table-scroll">
              <table className="t compact">
                <thead>
                  <tr>
                    <th scope="col">ارز</th>
                    <th scope="col">ورود</th>
                    <th scope="col">قیمت لحظه‌ای</th>
                    <th scope="col">سود/زیان باز</th>
                    <th scope="col">هدف / حد ضرر</th>
                  </tr>
                </thead>
                <tbody>
                  {live.open.map((o) => (
                    <tr key={o.coinId}>
                      <th scope="row">{o.symbol}</th>
                      <td className="num">{fmtNum(o.entryPrice, 4)}</td>
                      <td className="num">{fmtNum(o.markPrice, 4)}</td>
                      <td><Pct v={o.unrealisedPct} digits={2} /></td>
                      <td className="num muted">{fmtNum(o.targetPrice, 4)} / {fmtNum(o.stopPrice, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {live.fills.length ? (
            <div className="table-scroll">
              <table className="t compact">
                <thead>
                  <tr>
                    <th scope="col">ارز</th>
                    <th scope="col">خروج</th>
                    <th scope="col">بازده</th>
                    <th scope="col">سود/زیان</th>
                  </tr>
                </thead>
                <tbody>
                  {[...live.fills].reverse().slice(0, 12).map((f, i) => (
                    <tr key={`${f.coinId}-${f.exitAt}-${i}`}>
                      <th scope="row">{f.symbol}</th>
                      <td>{SWING_EXIT_LABEL[f.exit]}</td>
                      <td><Pct v={f.netPct} digits={2} /></td>
                      <td className="num">{tomanWords(f.pnlToman)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">هنوز معامله‌ای بسته نشده است.</p>
          )}

          <ul className="event-list">
            {live.events.slice(0, 5).map((e, i) => (
              <li className="event-row" key={i}>
                <span className="event-when">{fdt(e.at)}</span>
                <span className="event-text">{e.text}</span>
              </li>
            ))}
          </ul>

          <div className="admin">
            <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <button className="btn run danger" disabled={liveBusy || !secret} onClick={() => liveAction('stop')}>
              {liveBusy ? 'در حال بستن…' : 'پایان نوسان‌گیری برخط'}
            </button>
          </div>
          {liveErr ? <p className="empty">{liveErr}</p> : null}
        </section>
      ) : (
        <section className="panel pad live-swing">
          <h2>نوسان‌گیری برخط</h2>
          <p className="lede">
            همین موتور را روی قیمت واقعی اجرا می‌کند: خودش می‌خرد و می‌فروشد، هر معامله را ثبت می‌کند و به تلگرام خبر می‌دهد. پول واقعی جابه‌جا نمی‌شود.
            ارزها از همان «سبد ارزها» در حالت چند ارزی برداشته می‌شوند.
          </p>
          <div className="ticket-grid">
            <div>
              <span className="field-label">مدت</span>
              <Chips
                label="مدت"
                value={liveHours}
                onChange={setLiveHours}
                options={[{ key: '1', label: '۱ ساعت' }, { key: '6', label: '۶ ساعت' }, { key: '24', label: '۱ روز' }, { key: '72', label: '۳ روز' }, { key: '168', label: '۱ هفته' }]}
              />
              <small className="muted">تا ۳۶ ساعت با کندل ۵ دقیقه‌ای، بیشتر از آن با کندل ساعتی.</small>
            </div>
            <div>
              <span className="field-label">ارزهای انتخاب‌شده</span>
              <p className="muted">{basket.length ? basket.map((id) => menu?.coins.find((c) => c.id === id)?.symbol ?? id).join('، ') : 'در حالت «چند ارز همزمان» ارز انتخاب کنید.'}</p>
            </div>
          </div>
          <div className="admin">
            <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <button className="btn run" disabled={liveBusy || !secret || basket.length === 0} onClick={() => liveAction('start')}>
              {liveBusy ? 'در حال شروع…' : 'شروع نوسان‌گیری برخط'}
            </button>
          </div>
          <p className="muted small">برای دریافت اعلان هر معامله، در ربات تلگرام دستور <code>/live_on ADMIN_SECRET</code> را بفرستید.</p>
          {liveErr ? <p className="empty">{liveErr}</p> : null}
        </section>
      )}

      <div className="ticket panel pad">
        <h2 id="ticket-h">شرایط نوسان‌گیری</h2>
        <div className="ticket-grid">
          <div>
            <span className="field-label">حالت</span>
            <Chips
              label="حالت"
              value={mode}
              onChange={(v) => { setMode(v as Mode); setErr(null); }}
              options={[{ key: 'single', label: 'یک ارز' }, { key: 'multi', label: 'چند ارز همزمان' }, { key: 'auto', label: 'انتخاب خودکار' }]}
            />
            <span className="field-label" style={{ marginTop: 12 }}>
              {auto ? 'تعداد ارز انتخابی' : multi ? `سبد ارزها (${fmtInt(basket.length)} از ${fmtInt(MAX_BASKET)})` : 'ارز'}
            </span>
            {auto ? (
              <>
                <Chips label="تعداد" value={autoCount} onChange={setAutoCount} options={[{ key: '3', label: '۳ ارز' }, { key: '4', label: '۴ ارز' }, { key: '6', label: '۶ ارز' }]} />
                <small className="muted">
                  پرمعامله‌ترین ارزها و میم‌کوین‌ها بررسی می‌شوند. انتخاب فقط با نیمه اولِ تاریخچه انجام می‌شود و نتیجه روی نیمه دومِ دیده‌نشده گزارش می‌شود.
                </small>
              </>
            ) : menu ? (
              <>
                {/* a plain <select> is unusable at ~300 coins, so filter by name or symbol first */}
                <input
                  className="coin-search"
                  type="search"
                  inputMode="search"
                  placeholder="جست‌وجوی نام یا نماد…"
                  value={coinQuery}
                  onChange={(e) => setCoinQuery(e.target.value)}
                  aria-label="جست‌وجوی ارز"
                />
                {multi ? (
                  <>
                    <div className="chips basket-list" role="group" aria-label="انتخاب ارزها">
                      {shownCoins.slice(0, 60).map((c) => {
                        const on = basket.includes(c.id);
                        const full = !on && basket.length >= MAX_BASKET;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            
                            aria-pressed={on}
                            disabled={full}
                            title={full ? `حداکثر ${MAX_BASKET} ارز` : undefined}
                            onClick={() => toggleCoin(c.id)}
                          >
                            {c.picked ? '★ ' : ''}{c.symbol}{c.meme ? ' ·م' : ''}
                          </button>
                        );
                      })}
                    </div>
                    {basket.length ? (
                      <small className="muted">
                        سرمایه به‌طور مساوی بین {fmtInt(basket.length)} ارز تقسیم می‌شود؛ هر ارز جدا معامله می‌شود و از نقد بقیه قرض نمی‌گیرد.
                      </small>
                    ) : (
                      <small className="muted">دست‌کم یک ارز انتخاب کنید.</small>
                    )}
                  </>
                ) : (
                  <Select
                    label="ارز"
                    value={coinId}
                    onChange={setCoinId}
                    options={shownCoins.map((c) => ({
                      key: c.id,
                      label: `${c.picked ? '★ ' : ''}${c.name} (${c.symbol})${c.meme ? ' · میم‌کوین' : ''}`,
                    }))}
                  />
                )}
                <small className="muted">
                  {shownCoins.length === menu.coins.length
                    ? `${fmtInt(menu.coins.length)} ارز · ★ یعنی این هفته در فهرست غربال بوده`
                    : `${fmtInt(shownCoins.length)} از ${fmtInt(menu.coins.length)} ارز`}
                </small>
              </>
            ) : (
              <p className="muted">در حال دریافت فهرست…</p>
            )}
          </div>
          <div>
            <span className="field-label">بازه داده ساعتی</span>
            <Chips label="بازه" value={days} onChange={setDays} options={WINDOWS.map((w) => ({ key: w.key, label: w.label }))} />
          </div>
          <div>
            <span className="field-label">سبک معامله</span>
            <Chips
              label="سبک"
              value={preset}
              onChange={setPreset}
              options={(menu?.presets ?? [{ key: 'normal', label: 'متعادل', note: '' }]).map((p) => ({ key: p.key as typeof preset, label: p.label }))}
            />
            <small className="muted">{menu?.presets.find((p) => p.key === preset)?.note}</small>
          </div>
          <label className="field cap-field">
            <span className="field-label">سرمایه (تومان)</span>
            <input inputMode="numeric" value={capital} onChange={(e) => setCapital(e.target.value.replace(/[^\d]/g, ''))} />
            <small className="muted">{Number(capital) > 0 ? tomanWords(Number(capital)) : ''}</small>
          </label>
          <div>
            <span className="field-label">مبلغ‌های آماده</span>
            <Chips label="سرمایه آماده" value={capital} onChange={setCapital} options={CAPITALS.map((c) => ({ key: String(c), label: tomanWords(c) }))} />
          </div>
          <label className="field cap-field">
            <span className="field-label">کارمزد و اسپرد هر طرف (٪)</span>
            <input inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value.replace(/[^\d.]/g, ''))} />
            <small className="muted">پیش‌فرض ۰٫۴٪ — کارمزد صرافی داخلی به‌علاوه اسپرد تتر</small>
          </label>
        </div>
        <div className="ticket-foot">
          <button className="btn run" disabled={busy || !menu || (multi && basket.length === 0)} onClick={run}>
            {busy ? 'در حال اجرا…' : 'اجرای نوسان‌گیری'}
          </button>
        </div>
        {err ? <Empty>{err}</Empty> : null}
      </div>

      {scan ? (
        <div id="swing-result" className="sim-result">
          <section className="panel pad">
            <h2>غربال خودکار</h2>
            <p className="lede">
              انتخاب فقط با نیمه اول تاریخچه انجام شد؛ ستون «نیمه دوم» داده‌ای است که غربال هرگز ندیده. مقایسه این دو نشان می‌دهد انتخاب واقعاً کار کرده یا فقط به گذشته برازش شده.
            </p>
            <dl className="metrics">
              <div>
                <dt>ارزهای انتخاب‌شده (نیمه دوم)</dt>
                <dd><Pct v={scan.outSampleReturnPct} digits={1} /></dd>
              </div>
              <div>
                <dt>اگر همه نامزدها را می‌گرفتید</dt>
                <dd><Pct v={scan.allCandidatesReturnPct} digits={1} /></dd>
              </div>
              <div>
                <dt>خرید و نگه‌داری همان‌ها</dt>
                <dd><Pct v={scan.outSampleBuyHoldPct} digits={1} /></dd>
              </div>
            </dl>
            <p className="notes-1">{scan.verdict}</p>
            {scan.warnings.map((w, i) => (
              <p key={i} className="muted small">{w}</p>
            ))}
          </section>

          <section className="panel pad">
            <h2>نامزدها</h2>
            <div className="table-scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th scope="col">ارز</th>
                    <th scope="col">نیمه اول (انتخاب)</th>
                    <th scope="col">نیمه دوم (دیده‌نشده)</th>
                    <th scope="col">معاملات</th>
                    <th scope="col">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.candidates.map((c) => (
                    <tr key={c.coin.id} className={c.selected ? 'picked-row' : undefined}>
                      <th scope="row">
                        {c.coin.symbol}
                        {c.coin.meme ? <span className="muted small"> · میم‌کوین</span> : null}
                      </th>
                      {c.inSample && c.outSample ? (
                        <>
                          <td><Pct v={c.inSample.returnPct} digits={1} /></td>
                          <td><Pct v={c.outSample.returnPct} digits={1} /></td>
                          <td className="num">{fmtInt(c.inSample.trades)}</td>
                          <td>{c.selected ? <span className="state-pill ok">انتخاب شد</span> : <span className="muted">—</span>}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="muted">{c.reason}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn"
              onClick={() => { setBasket(scan.selected.map((c) => c.coin.id).slice(0, MAX_BASKET)); setMode('multi'); setScan(null); }}
            >
              این ارزها را در حالت چند ارزی بگذار
            </button>
          </section>
        </div>
      ) : null}

      {pf ? (
        <div id="swing-result" className={scan ? 'sim-result' : 'sim-result'}>
          <section className="panel pad">
            <h2>نتیجه سبد {fmtInt(pf.used)} ارزی</h2>
            <dl className="metrics">
              <div>
                <dt>ارزش نهایی سبد</dt>
                <dd className="num">{tomanWords(pf.combined.finalEquity)}</dd>
              </div>
              <div>
                <dt>بازده سبد</dt>
                <dd><Pct v={pf.combined.returnPct} digits={1} /></dd>
              </div>
              <div>
                <dt>خرید و نگه‌داری همین سبد</dt>
                <dd><Pct v={pf.combined.buyHoldPct} digits={1} /></dd>
              </div>
              <div>
                <dt>بیشینه افت سبد</dt>
                <dd><Pct v={pf.combined.maxDrawdownPct} digits={1} /></dd>
              </div>
              <div>
                <dt>معاملات</dt>
                <dd className="num">{fmtInt(pf.combined.trades)}{pf.combined.winRatePct !== null ? ` · ${fmtPct(pf.combined.winRatePct, 0, false)} برد` : ''}</dd>
              </div>
              <div>
                <dt>کارمزد پرداختی</dt>
                <dd className="num">{tomanWords(pf.combined.feesToman)}</dd>
              </div>
            </dl>
            <p className="muted small">سهم هر ارز {tomanWords(pf.sleeveCapitalToman)} است. هر ارز مستقل معامله می‌شود، پس ضرر یکی با نقد دیگری پوشانده نمی‌شود.</p>
            {pf.warnings.map((w, i) => (
              <p key={i} className="notes-1">{w}</p>
            ))}
          </section>

          <section className="panel pad">
            <h2>سهم هر ارز</h2>
            <div className="table-scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th scope="col">ارز</th>
                    <th scope="col">بازده</th>
                    <th scope="col">خرید و نگه‌داری</th>
                    <th scope="col">معاملات</th>
                    <th scope="col">برد</th>
                    <th scope="col">بیشینه افت</th>
                  </tr>
                </thead>
                <tbody>
                  {pf.sleeves.map((sl) => (
                    <tr key={sl.coin.id}>
                      <th scope="row">{sl.coin.symbol}</th>
                      {sl.ok && sl.result ? (
                        <>
                          <td><Pct v={sl.result.metrics.returnPct} digits={1} /></td>
                          <td className="muted"><Pct v={sl.result.metrics.buyHoldPct} digits={1} /></td>
                          <td className="num">{fmtInt(sl.result.metrics.trades)}</td>
                          <td className="num">{sl.result.metrics.winRatePct === null ? '—' : fmtPct(sl.result.metrics.winRatePct, 0, false)}</td>
                          <td><Pct v={sl.result.metrics.maxDrawdownPct} digits={1} /></td>
                        </>
                      ) : (
                        <td colSpan={5} className="muted">{sl.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pf.best ? (
              <p className="muted small">
                بهترین: {pf.best.symbol} ({fmtPct(pf.best.returnPct, 1)}){pf.worst ? ` · ضعیف‌ترین: ${pf.worst.symbol} (${fmtPct(pf.worst.returnPct, 1)})` : ''}
              </p>
            ) : null}
            <p className="muted small">این آزمون روی گذشته است و تضمینی برای آینده نیست.</p>
          </section>
        </div>
      ) : null}

      {res && m ? (
        <div id="swing-result" className="sim-result">
          <section className="panel pad">
            <h2>
              نتیجه {res.coin.name} · {res.preset.label}
            </h2>
            <dl className="metrics">
              <div>
                <dt>ارزش نهایی</dt>
                <dd className="num">{tomanWords(m.finalEquity)}</dd>
              </div>
              <div>
                <dt>بازده استراتژی</dt>
                <dd>
                  <Pct v={m.returnPct} digits={2} />
                </dd>
              </div>
              <div>
                <dt>خرید و نگه‌داری همان ارز</dt>
                <dd>
                  <Pct v={m.buyHoldPct} digits={2} />
                </dd>
              </div>
              <div>
                <dt>تفاوت با خرید و نگه‌داری</dt>
                <dd>
                  <Pct v={beatHold} digits={2} />
                </dd>
              </div>
              <div>
                <dt>معاملات</dt>
                <dd className="num">{fmtInt(m.trades)}</dd>
              </div>
              <div>
                <dt>معاملات سودده</dt>
                <dd className="num">{isNum(m.winRatePct) ? fmtPct(m.winRatePct, 0, false) : '—'}</dd>
              </div>
              <div>
                <dt>بیشترین افت سرمایه</dt>
                <dd className="num">{fmtPct(m.maxDrawdownPct, 1, false)}</dd>
              </div>
              <div>
                <dt>کارمزد پرداخت‌شده</dt>
                <dd className="num">{tomanWords(m.feesToman)}</dd>
              </div>
              <div>
                <dt>میانگین مدت هر معامله</dt>
                <dd className="num">{isNum(m.avgHoldH) ? `${fmtNum(m.avgHoldH, 0)} ساعت` : '—'}</dd>
              </div>
              <div>
                <dt>زمان در بازار</dt>
                <dd className="num">{fmtPct(m.timeInMarketPct, 0, false)}</dd>
              </div>
              <div>
                <dt>بهترین / بدترین معامله</dt>
                <dd className="num">
                  {isNum(m.bestPct) ? fmtPct(m.bestPct, 1) : '—'} / {isNum(m.worstPct) ? fmtPct(m.worstPct, 1) : '—'}
                </dd>
              </div>
              <div>
                <dt>بازه داده</dt>
                <dd>
                  {fmtDateTimeFa(m.fromAt)} تا {fmtDateTimeFa(m.toAt)}
                </dd>
              </div>
            </dl>
            {res.warnings.length ? (
              <ul className="notes">
                {res.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <div>
            <h2>ارزش سرمایه در طول دوره</h2>
            <div className="chart-host equity-host">
              <EquityChart lines={lines} markers={markers} intraday label="نمودار ارزش سرمایه نوسان‌گیری" />
            </div>
          </div>

          {res.trades.length ? (
            <div>
              <h2 id="journal-h">دفتر معاملات</h2>
              <Chips
                label="فیلتر"
                value={exitFilter}
                onChange={setExitFilter}
                options={[
                  { key: 'all', label: 'همه', count: res.trades.length },
                  { key: 'win', label: 'سودده', count: res.trades.filter((t) => t.pnlToman > 0).length },
                  { key: 'loss', label: 'زیان‌ده', count: res.trades.filter((t) => t.pnlToman <= 0).length },
                ]}
              />
              <div className="table-scroll">
                <table className="t">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">ورود</th>
                      <th scope="col">خروج</th>
                      <th scope="col">مدت</th>
                      <th scope="col">قیمت ورود / خروج ($)</th>
                      <th scope="col">بازده خالص</th>
                      <th scope="col">سود / زیان</th>
                      <th scope="col">علت خروج</th>
                      <th scope="col">دلیل ورود</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownTrades.map((t) => (
                      <tr key={t.n}>
                        <td className="num muted">{fmtInt(t.n)}</td>
                        <td>{fmtDateTimeFa(t.entryAt)}</td>
                        <td>{fmtDateTimeFa(t.exitAt)}</td>
                        <td className="num">{fmtInt(t.holdH)} ساعت</td>
                        <td className="num">
                          {fmtNum(t.entryPrice, t.entryPrice < 1 ? 5 : 2)} / {fmtNum(t.exitPrice, t.exitPrice < 1 ? 5 : 2)}
                        </td>
                        <td>
                          <Pct v={t.netPct} digits={2} />
                        </td>
                        <td className={`num ${t.pnlToman >= 0 ? 'up' : 'down'}`}>{tomanWords(t.pnlToman)}</td>
                        <td>{SWING_EXIT_LABEL[t.exit]}</td>
                        <td className="reasons">{t.entryReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <Empty>در این بازه سیگنال ورودی صادر نشد. بازه بلندتر یا سبک پرتحرک‌تر را امتحان کنید.</Empty>
          )}

          <details className="method">
            <summary>روش محاسبه و محدودیت‌ها</summary>
            <ul className="notes">
              <li>داده ساعتی از CoinGecko گرفته می‌شود و فقط قیمت بسته‌شدن هر ساعت را دارد؛ سقف و کف درون‌ساعتی موجود نیست. پس حد ضرر در همان کندلی شناسایی می‌شود که بسته‌شدنش از آن عبور کرده و برای جبران این خوش‌بینی، ۰٫۱۵٪ لغزش اضافه روی خروج‌های حد ضرر حساب می‌شود.</li>
              <li>ورود: در روند صعودی (میانگین {fmtInt(res.preset.fastH)} ساعته بالای {fmtInt(res.preset.slowH)} ساعته) و یکی از این سه حالت — اصلاح تا زیر میانگین سریع، اشباع فروش (RSI)، یا شکست سقف {fmtInt(res.preset.breakoutH)} ساعته. جهش‌های عمودی کوتاه‌مدت حذف می‌شوند.</li>
              <li>هدف سود و حد ضرر بر پایه نوسان واقعی همان ارز در ۷۲ ساعت گذشته تعیین می‌شود، نه درصد ثابت.</li>
              <li>در هر لحظه حداکثر یک موقعیت باز است، بدون اهرم و بدون فروش استقراضی. بخشی از سرمایه که وارد معامله می‌شود {fmtPct(res.preset.exposure * 100, 0, false)} است و بقیه نقد می‌ماند.</li>
              <li>این یک آزمون گذشته‌نگر روی یک بازه محدود است. نتیجه خوب در گذشته تضمینی برای آینده نیست و کارمزد واقعی صرافی شما ممکن است بیشتر باشد.</li>
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}
