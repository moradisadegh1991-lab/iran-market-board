'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmtDateTimeFa, fmtInt, isNum } from '@/lib/num';
import { PROFILES, SIM_ASSETS, type SimAsset, type SimProfile } from '@/lib/engine/simulator';
import type { LiveSession, LiveTrade } from '@/lib/engine/live';
import { Chips, MultiChips, PageHead, Pct } from '../ui';
import TradeEntry, { tomanWords } from '../TradeEntry';
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

export default function LiveView() {
  const [state, setState] = useState<PaperState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [capital, setCapital] = useState('500000000');
  const [profile, setProfile] = useState<SimProfile>('balanced');
  const [assets, setAssets] = useState<SimAsset[]>(['usd', 'g18', 'coin', 'btc']);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    fetch('/api/paper', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: PaperState) => {
        if (j.error) throw new Error(j.error);
        setState(j);
        setLoadErr(null);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 20_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function start() {
    setBusy(true);
    setActionErr(null);
    try {
      const capitalToman = Number(capital);
      const r = await fetch('/api/paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify({ action: 'start', capitalToman, profile, assets, days: Number(days), useNews: true }),
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
    setBusy(true);
    setActionErr(null);
    try {
      const r = await fetch('/api/paper', {
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

  const active = state?.active ?? null;
  const shown = active ?? state?.lastFinished ?? null;
  const lastEq = shown?.equity[shown.equity.length - 1];
  const equityToman = lastEq?.equity ?? shown?.config.capitalToman ?? null;
  const returnPct = isNum(equityToman) && shown ? (equityToman / shown.config.capitalToman - 1) * 100 : null;
  const daysLeft = active ? Math.max(0, Math.ceil((active.endsAt - (state?.serverNow ?? Date.now())) / 86400000)) : null;

  const lines: EquityLine[] = shown
    ? [{ key: 'live', label: 'ارزش سبد', color: 'var(--teal)', width: 2, points: shown.equity.map((p) => ({ date: p.date, value: p.equity, t: p.at })) }]
    : [];
  const markers = (shown?.trades ?? []).map((t: LiveTrade) => ({ date: t.at ? new Date(t.at).toISOString().slice(0, 10) : '', side: t.side, text: `${META[t.asset].label} ${t.side === 'buy' ? 'خرید' : 'فروش'}`, at: t.at }));

  return (
    <>
      <PageHead title="معامله برخط">
        معامله کاغذی روی قیمت واقعی بازار، تیک به تیک — بدون پول واقعی. همان موتور و قواعد شبیه‌ساز، این‌بار روی داده زنده. هر معامله در تلگرام هم اطلاع داده می‌شود
        (<code>/live_on ADMIN_SECRET</code> نزد ربات).
      </PageHead>

      {loadErr ? <p className="empty">دریافت وضعیت ممکن نشد: {loadErr}</p> : null}

      {!state ? (
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
            </div>
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
            <h2>پایان معامله</h2>
            <p className="lede">با قیمت لحظه‌ای بسته می‌شود و گزارش نهایی به تلگرام‌های ثبت‌شده ارسال می‌شود.</p>
            <div className="admin">
              <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
              <button className="btn run danger" disabled={busy || !secret} onClick={stop}>
                {busy ? 'در حال بستن…' : 'پایان معامله'}
              </button>
            </div>
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
              </div>
            </div>
          ) : null}

          <div className="ticket panel pad">
            <h2 id="ticket-h">شروع معامله برخط</h2>
            <div className="ticket-grid">
              <label className="field cap-field">
                <span className="field-label">سرمایه اولیه (تومان)</span>
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
                <span className="field-label">دارایی‌ها</span>
                <MultiChips label="دارایی‌های مجاز" value={assets} onChange={setAssets} options={SIM_ASSETS.map((a) => ({ key: a.key, label: a.label }))} />
              </div>
            </div>
            <div className="admin">
              <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} />
              <button className="btn run" disabled={busy || !secret} onClick={start}>
                {busy ? 'در حال شروع…' : 'شروع معامله برخط'}
              </button>
            </div>
            {actionErr ? <p className="empty">{actionErr}</p> : null}
          </div>
        </div>
      )}
    </>
  );
}
