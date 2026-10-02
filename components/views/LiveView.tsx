'use client';
import { api } from '@/lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmtDateTimeFa, fmtInt, isNum } from '@/lib/num';
import { ACTIVITY_LABEL, PROFILES, SIM_ASSETS, type Activity, type SimAsset, type SimProfile } from '@/lib/engine/simulator';
import { untouchedValueToman, type LiveSession, type LiveTrade } from '@/lib/engine/live';
import { holdingsForLive } from '@/lib/finance/compare';
import { useFinance } from '../finance/FinanceProvider';
import Link from 'next/link';
import { AdminActions, Chips, MultiChips, PageHead, Pct, Toggle } from '../ui';
import TradeEntry, { tomanWords } from '../TradeEntry';
import { useNotify } from '../NotifyProvider';
import { callLocal, loadLivePrefs, loadLocalSession, saveLivePrefs, tradeNote } from '@/lib/live-local';
import type { EquityLine } from '../EquityChart';

const EquityChart = dynamic(() => import('../EquityChart'), { ssr: false, loading: () => <div className="chart-host equity-host skeleton" /> });

type StoredSession = LiveSession & { learning: unknown };
interface PaperState {
  active: StoredSession | null;
  lastFinished: StoredSession | null;
  history: { id: string; finishedAt: number; returnPct: number; trades: number; profile: SimProfile }[];
  notifyChats: number;
  serverNow: number;
  error?: string;
}

const META = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<SimAsset, (typeof SIM_ASSETS)[number]>;
const DAYS = [
  { key: '7', label: '۱ هفته' },
  { key: '30', label: '۱ ماه' },
  { key: '90', label: '۳ ماه' },
] as const;

function EventRow({ e }: { e: LiveSession['events'][number] }) {
  return (
    <li className="event-row">
      <span className="event-when">{fmtDateTimeFa(e.at)}</span>
      <span className="event-text">{e.text}</span>
    </li>
  );
}

type Mode = 'device' | 'shared';

export default function LiveView() {
  const { notify } = useNotify();
  const { data: book } = useFinance();
  const [fromHoldings, setFromHoldings] = useState(false);
  const mine = book ? holdingsForLive(book) : { holdings: [], unsupported: [] };
  const [mode, setMode] = useState<Mode>('device');
  const [state, setState] = useState<PaperState | null>(null);
  const [local, setLocal] = useState<LiveSession | null>(null);
  const [localLoaded, setLocalLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [capital, setCapital] = useState('100000000');
  const [profile, setProfile] = useState<SimProfile>('balanced');
  const [assets, setAssets] = useState<SimAsset[]>(['usd', 'g18', 'coin', 'btc']);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [activity, setActivity] = useState<Activity>('normal');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // the device's own session (and the form defaults it was last started with)
  useEffect(() => {
    setLocal(loadLocalSession());
    const p = loadLivePrefs();
    setCapital(String(p.capital));
    setProfile(p.profile);
    setAssets(p.liveAssets.filter((k) => SIM_ASSETS.some((a) => a.key === k)) as SimAsset[]);
    setDays(p.liveDays === 7 ? '7' : p.liveDays === 90 ? '90' : '30');
    setActivity(p.activity);
    setLocalLoaded(true);
  }, []);

  const load = useCallback(() => {
    fetch(api('/api/paper'), { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: PaperState) => {
        if (j.error) throw new Error(j.error);
        setState(j);
        setLoadErr(null);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (mode !== 'shared') return;
    load();
    pollRef.current = setInterval(load, 20_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load, mode]);

  async function deviceCall(action: 'start' | 'tick' | 'stop') {
    setBusy(true);
    setActionErr(null);
    try {
      const useMine = action === 'start' && fromHoldings && mine.holdings.length > 0;
      const prefs = { capital: useMine ? Number(capital) || 0 : Number(capital), profile, liveAssets: assets, liveDays: Number(days), activity };
      if (action === 'start' && !useMine) saveLivePrefs(prefs);
      const r = await callLocal(action, prefs, local, useMine ? mine.holdings : undefined);
      setLocal(r.session);
      r.newTrades.forEach((t) => {
        const n = tradeNote(t);
        notify(n.title, n.body, 'trade');
      });
      if (action === 'start') notify('معامله برخط شروع شد', `سرمایه ${tomanWords(r.session.config.capitalToman)}${useMine ? ' با دارایی‌های خودتان' : ''} · فقط روی همین دستگاه`, 'trade');
      else if (r.finished) notify('معامله برخط پایان یافت', 'گزارش نهایی آماده است.', 'trade');
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (mode === 'device') return deviceCall('start');
    setBusy(true);
    setActionErr(null);
    try {
      const capitalToman = Number(capital);
      const r = await fetch(api('/api/paper'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify({ action: 'start', capitalToman, profile, assets, days: Number(days), activity, useNews: true }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!confirm('معامله برخط الان با قیمت روز بسته شود؟')) return;
    if (mode === 'device') return deviceCall('stop');
    setBusy(true);
    setActionErr(null);
    try {
      const r = await fetch(api('/api/paper'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify({ action: 'stop' }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `خطای ${r.status}`);
      load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const device = mode === 'device';
  const ready = device ? localLoaded : !!state;
  const active = device ? (local?.status === 'running' ? local : null) : (state?.active ?? null);
  const shown = active ?? (device ? (local?.status === 'finished' ? local : null) : (state?.lastFinished ?? null));
  const nowMs = device ? Date.now() : (state?.serverNow ?? Date.now());
  const lastEq = shown?.equity[shown.equity.length - 1];
  const equityToman = lastEq?.equity ?? shown?.config.capitalToman ?? null;
  const returnPct = isNum(equityToman) && shown ? (equityToman / shown.config.capitalToman - 1) * 100 : null;
  const daysLeft = active ? Math.max(0, Math.ceil((active.endsAt - nowMs) / 86400000)) : null;
  // started from the user's holdings: what doing nothing would be worth now
  const untouched = shown ? untouchedValueToman(shown, nowMs) : null;

  const lines: EquityLine[] = shown
    ? [{ key: 'live', label: 'ارزش سبد', color: 'var(--teal)', width: 2, points: shown.equity.map((p) => ({ date: p.date, value: p.equity, t: p.at })) }]
    : [];
  const markers = (shown?.trades ?? []).map((t: LiveTrade) => ({ date: t.at ? new Date(t.at).toISOString().slice(0, 10) : '', side: t.side, text: `${META[t.asset].label} ${t.side === 'buy' ? 'خرید' : 'فروش'}`, at: t.at }));

  return (
    <div className="wrap">
      <PageHead title="معامله برخط">
        معامله کاغذی روی قیمت واقعی بازار — بدون پول واقعی. همان موتور و قواعد شبیه‌ساز، این‌بار روی داده زنده.
      </PageHead>
      <div className="filterbar">
        <Chips<Mode>
          label="کدام جلسه"
          value={mode}
          onChange={setMode}
          options={[
            { key: 'device', label: 'جلسه من (روی همین دستگاه)' },
            { key: 'shared', label: 'جلسه مشترک سایت' },
          ]}
        />
      </div>
      <p className="muted small">
        {device
          ? 'این جلسه فقط روی همین دستگاه ذخیره می‌شود و به سرور نمی‌رود. فقط وقتی اپ باز است پیش می‌رود: هر بار که اپ را باز کنید قیمت‌ها بررسی می‌شوند.'
          : 'یک جلسه مشترک روی سرور که همه بازدیدکنندگان سایت می‌بینند؛ شروع و پایانش با رمز مدیر است و هر معامله در تلگرام هم اعلام می‌شود.'}
      </p>

      {!device && loadErr ? <p className="empty">دریافت وضعیت ممکن نشد: {loadErr}</p> : null}

      {!ready ? (
        <p className="empty">در حال دریافت وضعیت…</p>
      ) : active ? (
        <div className="sim-result">
          <div className="live-status panel pad">
            <div className="live-status-top">
              <span className="state-pill ok">در حال اجرا</span>
              <span className="muted">موتور نسخه {fmtInt(active.params.version)}</span>
            </div>
            <div className="ticket-grid">
              <div>
                <div className="k">ارزش سبد</div>
                <div className="v big">{tomanWords(equityToman ?? 0)}</div>
                <Pct v={returnPct} digits={2} />
              </div>
              <div>
                <div className="k">سرمایه اولیه</div>
                <div className="v big">{tomanWords(active.config.capitalToman)}</div>
                <span className="muted">پروفایل {PROFILES[active.config.profile].label}</span>
              </div>
              <div>
                <div className="k">تا پایان</div>
                <div className="v big">{fmtInt(daysLeft ?? 0)} روز</div>
                <span className="muted">پایان: {fmtDateTimeFa(active.endsAt)}</span>
              </div>
              <div>
                <div className="k">معاملات</div>
                <div className="v big">{fmtInt(active.trades.length)}</div>
                <span className="muted">آخرین بررسی: {fmtDateTimeFa(active.lastTickAt)}</span>
              </div>
              {isNum(untouched) ? (
                <div>
                  <div className="k">اگر به دارایی‌ها دست نمی‌زدید</div>
                  <div className="v big">{tomanWords(untouched)}</div>
                  {isNum(equityToman) ? (
                    <span className={equityToman >= untouched ? 'up' : 'down'}>
                      معامله‌ها {equityToman >= untouched ? 'جلوتر' : 'عقب‌تر'}: {tomanWords(Math.abs(equityToman - untouched))}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {active.config.startHoldings?.length ? (
              <p className="muted small">این جلسه با دارایی‌های خودتان شروع شده؛ معامله کاغذی است و دارایی‌های دفترتان تغییری نمی‌کنند.</p>
            ) : null}
          </div>

          <div>
            <h2>ارزش سرمایه از شروع</h2>
            <div className="chart-host equity-host">
              <EquityChart lines={lines} markers={markers} intraday label="نمودار ارزش سبد معامله برخط" />
            </div>
          </div>

          {active.trades.length ? (
            <div>
              <h2>دفتر معاملات</h2>
              <ul className="journal">
                {[...active.trades].reverse().map((t) => (
                  <TradeEntry key={t.n} t={t} at={t.at} />
                ))}
              </ul>
            </div>
          ) : (
            <p className="empty">هنوز معامله‌ای ثبت نشده؛ موتور منتظر فرصت مناسب است.</p>
          )}

          {active.events.length ? (
            <div>
              <h2>رویدادها</h2>
              <ul className="event-list">
                {active.events.slice(0, 12).map((e, i) => (
                  <EventRow key={i} e={e} />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="ticket panel pad">
            <h2>{device ? 'بررسی و پایان' : 'پایان معامله'}</h2>
            {device ? (
              <>
                <p className="lede">هر بار که اپ باز شود خودکار بررسی می‌شود؛ هر وقت خواستید همین الان هم می‌توانید قیمت‌ها را بررسی کنید.</p>
                <div className="admin">
                  <button className="btn run" disabled={busy} onClick={() => void deviceCall('tick')}>
                    {busy ? 'در حال بررسی…' : 'بررسی حالا'}
                  </button>
                  <button className="btn run danger" disabled={busy} onClick={stop}>
                    پایان دادن
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="lede">با قیمت لحظه‌ای بسته می‌شود و گزارش نهایی به تلگرام‌های ثبت‌شده ارسال می‌شود.</p>
                <AdminActions>
                  <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
                  <button className="btn run danger" disabled={busy || !secret} onClick={stop}>
                    {busy ? 'در حال بستن…' : 'پایان معامله'}
                  </button>
                </AdminActions>
              </>
            )}
            {actionErr ? <p className="empty">{actionErr}</p> : null}
          </div>
        </div>
      ) : (
        <div className="sim-result">
          {shown ? (
            <div className="live-status panel pad">
              <div className="live-status-top">
                <span className="state-pill warn">پایان‌یافته ({shown.endReason === 'stopped' ? 'به دستور کاربر' : 'پایان مدت'})</span>
              </div>
              <div className="ticket-grid">
                <div>
                  <div className="k">نتیجه</div>
                  <div className="v big">{tomanWords(equityToman ?? 0)}</div>
                  <Pct v={returnPct} digits={2} />
                </div>
                <div>
                  <div className="k">معاملات</div>
                  <div className="v big">{fmtInt(shown.trades.length)}</div>
                </div>
                {isNum(untouched) ? (
                  <div>
                    <div className="k">اگر دست نمی‌زدید</div>
                    <div className="v big">{tomanWords(untouched)}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="ticket panel pad">
            <h2 id="ticket-h">شروع معامله برخط</h2>
            {device ? (
              <div className="live-mine">
                <Toggle checked={fromHoldings} onChange={setFromHoldings}>
                  با دارایی‌های خودم شروع کن (از «حساب و دارایی»)
                </Toggle>
                {fromHoldings ? (
                  mine.holdings.length ? (
                    <p className="muted small">
                      موتور با همین‌ها شروع می‌کند و خودش تصمیم می‌گیرد نگه دارد، بفروشد یا بخرد:{' '}
                      {mine.holdings.map((h) => `${META[h.asset].label} ${h.qty.toLocaleString('fa-IR', { maximumFractionDigits: 6 })} ${META[h.asset].unit}`).join('، ')}
                      {mine.unsupported.length ? ` · در معامله برخط نیستند: ${mine.unsupported.join('، ')}` : ''}. کاغذی است؛ دفتر شما تغییر نمی‌کند.
                    </p>
                  ) : (
                    <p className="empty">
                      دارایی قابل معامله‌ای (دلار، طلای ۱۸، سکه امامی، بیت‌کوین، اتریوم) در <Link href="/accounts">حساب و دارایی</Link> ثبت نکرده‌اید.
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
            <div className="ticket-grid">
              <label className="field cap-field">
                <span className="field-label">{device && fromHoldings ? 'نقد اضافه کنار دارایی‌ها (تومان، اختیاری)' : 'سرمایه اولیه (تومان)'}</span>
                <input inputMode="numeric" value={capital} onChange={(e) => setCapital(e.target.value.replace(/[^\d]/g, ''))} />
                <small className="muted">{isNum(Number(capital)) && Number(capital) > 0 ? tomanWords(Number(capital)) : ''}</small>
              </label>
              <div>
                <span className="field-label">مدت</span>
                <Chips label="مدت" value={days} onChange={setDays} options={DAYS.map((d) => ({ key: d.key, label: d.label }))} />
              </div>
              <div>
                <span className="field-label">پروفایل ریسک</span>
                <Chips label="پروفایل" value={profile} onChange={setProfile} options={Object.entries(PROFILES).map(([k, v]) => ({ key: k as SimProfile, label: v.label }))} />
              </div>
              <div>
                <span className="field-label">سبک معامله</span>
                <Chips
                  label="سبک معامله"
                  value={activity}
                  onChange={setActivity}
                  options={(Object.keys(ACTIVITY_LABEL) as Activity[]).map((k) => ({ key: k, label: ACTIVITY_LABEL[k] }))}
                />
                <small className="muted">
                  «پرمعامله» آستانه ورود را پایین و بازه تحمل وزن را باریک می‌کند، پس بیشتر معامله می‌کند. در سنجش ما تعداد معامله‌ها حدود ۴۰٪ بالا رفت ولی بازده کمی پایین‌تر آمد، چون هر رفت‌وبرگشت دو بار اسپرد می‌دهد.
                </small>
              </div>
              <div>
                <span className="field-label">دارایی‌ها</span>
                <MultiChips label="دارایی‌های مجاز" value={assets} onChange={setAssets} options={SIM_ASSETS.map((a) => ({ key: a.key, label: a.label }))} />
              </div>
            </div>
            {device ? (
              <div className="admin">
                <button
                  className="btn run"
                  disabled={busy || (fromHoldings ? !mine.holdings.length : !assets.length || !(Number(capital) >= 1_000_000))}
                  onClick={start}
                >
                  {busy ? 'در حال شروع…' : 'شروع معامله برخط من'}
                </button>
              </div>
            ) : (
              <AdminActions>
                <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
                <button className="btn run" disabled={busy || !secret} onClick={start}>
                  {busy ? 'در حال شروع…' : 'شروع معامله برخط'}
                </button>
              </AdminActions>
            )}
            {actionErr ? <p className="empty">{actionErr}</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}
