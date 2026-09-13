'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmtDateTimeFa, fmtInt, fmtNum, fmtPct, isNum } from '@/lib/num';
import { SWING_EXIT_LABEL, type SwingResult } from '@/lib/engine/swing';
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
      const r = await fetch('/api/swing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coinId, symbol: coin?.symbol, name: coin?.name, days: Number(days), capitalToman: Number(capital), preset, feePct: Number(feePct) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      setRes(j);
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

      <div className="ticket panel pad">
        <h2 id="ticket-h">شرایط نوسان‌گیری</h2>
        <div className="ticket-grid">
          <div>
            <span className="field-label">ارز</span>
            {menu ? (
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
                <Select
                  label="ارز"
                  value={coinId}
                  onChange={setCoinId}
                  options={shownCoins.map((c) => ({
                    key: c.id,
                    label: `${c.picked ? '★ ' : ''}${c.name} (${c.symbol})${c.meme ? ' · میم‌کوین' : ''}`,
                  }))}
                />
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
          <button className="btn run" disabled={busy || !menu} onClick={run}>
            {busy ? 'در حال اجرا…' : 'اجرای نوسان‌گیری'}
          </button>
        </div>
        {err ? <Empty>{err}</Empty> : null}
      </div>

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
