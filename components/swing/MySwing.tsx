'use client';
// «نوسان‌گیری برخط من» (rule 97): a live swing session kept on this device. Start picks the coins (the calm
// picks by default), capital, style and length; the session advances whenever the app is open (AppStartup)
// or the refresh button is pressed, replaying every hour since its start, so nothing is lost while closed.
import { useCallback, useEffect, useState } from 'react';
import { fmtInt } from '@/lib/num';
import { SWING_PRESETS } from '@/lib/engine/swing';
import type { SwingLiveSession } from '@/lib/engine/swing-live';
import type { PickRow } from '@/lib/engine/coin-pick';
import { callSwingLocal, loadSwingPrefs, loadSwingSession, saveSwingPrefs, saveSwingSession, swingFillNote, SWING_TICK_MS, type SwingPrefs } from '@/lib/swing-local';
import { useNotify } from '../NotifyProvider';
import { Chips } from '../ui';
import SwingSessionCard from './SwingSessionCard';
import { usePicks } from './CoinPicks';

const HOURS = [
  { key: '24', label: '۱ روز' },
  { key: '72', label: '۳ روز' },
  { key: '168', label: '۱ هفته' },
  { key: '336', label: '۲ هفته' },
  { key: '720', label: '۳۰ روز' },
];
const CAPS = [
  { key: '100000000', label: '۱۰۰ میلیون' },
  { key: '500000000', label: '۵۰۰ میلیون' },
  { key: '1000000000', label: '۱ میلیارد' },
];

export default function MySwing({ basket }: { basket: { id: string; symbol: string; name: string }[] }) {
  const { notify } = useNotify();
  const { data: picks } = usePicks();
  const [s, setS] = useState<SwingLiveSession | null>(null);
  const [prefs, setPrefs] = useState<SwingPrefs | null>(null);
  const [useBasket, setUseBasket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setS(loadSwingSession());
    setPrefs(loadSwingPrefs());
  }, []);
  const setP = (p: Partial<SwingPrefs>) => setPrefs((x) => {
    const n = { ...(x ?? loadSwingPrefs()), ...p };
    saveSwingPrefs(n);
    return n;
  });

  const coins: { id: string; symbol: string; name: string }[] = useBasket && basket.length ? basket : (picks?.picked ?? []).map((r: PickRow) => ({ id: r.id, symbol: r.sym, name: r.name }));

  const act = useCallback(async (action: 'start' | 'tick' | 'stop') => {
    setBusy(true);
    setErr(null);
    try {
      const p = prefs ?? loadSwingPrefs();
      const r = action === 'start'
        ? await callSwingLocal('start', { config: { coins, capitalToman: p.capital, preset: p.preset, hours: p.hours } })
        : await callSwingLocal(action, { session: s });
      setS(r.session);
      r.newFills.forEach((f) => {
        const n = swingFillNote(f);
        notify(n.title, n.body, 'trade', '/swing', true);
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [coins, prefs, s, notify]);

  // catch up on open (AppStartup also does this in the app; on the website this is the only heartbeat)
  useEffect(() => {
    if (s?.status === 'running' && Date.now() - s.lastTickAt >= SWING_TICK_MS && !busy) void act('tick');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id]);

  if (s) {
    return (
      <SwingSessionCard s={s} title="نوسان‌گیری برخط من (روی همین دستگاه)" testId="my-swing">
        <div className="admin">
          {s.status === 'running' ? (
            <>
              <button className="btn run" disabled={busy} onClick={() => act('tick')}>{busy ? 'در حال بررسی…' : 'بررسی همین حالا'}</button>
              <button className="btn run danger" disabled={busy} onClick={() => act('stop')} data-testid="my-swing-stop">پایان جلسه</button>
            </>
          ) : (
            <button className="btn run" onClick={() => { saveSwingSession(null); setS(null); }}>جلسه تازه</button>
          )}
        </div>
        <p className="muted small">
          فقط روی همین گوشی ذخیره می‌شود. وقتی اپ بسته است چیزی اجرا نمی‌شود، ولی با باز شدن دوباره، همه ساعت‌های گذشته از روی کندل‌های واقعی بازپخش می‌شوند و معامله‌ها همان می‌شوند که
          اگر اپ باز بود. پول واقعی جابه‌جا نمی‌شود.
        </p>
        {err ? <p className="empty">{err}</p> : null}
      </SwingSessionCard>
    );
  }

  const p = prefs ?? loadSwingPrefs();
  return (
    <section className="panel pad live-swing" data-testid="my-swing-start">
      <h2>نوسان‌گیری برخط من</h2>
      <p className="lede">
        همین موتور روی قیمت واقعی، برای خودتان و روی همین دستگاه: خودش می‌خرد و می‌فروشد و هر معامله را با اعلان خبر می‌دهد. پول واقعی جابه‌جا نمی‌شود.
      </p>
      <div className="ticket-grid">
        <div>
          <span className="field-label">ارزها</span>
          <Chips
            label="ارزها"
            value={useBasket && basket.length ? 'basket' : 'picks'}
            onChange={(v) => setUseBasket(v === 'basket')}
            options={[{ key: 'picks', label: 'ارزهای پیشنهادی' }, { key: 'basket', label: `سبد خودم (${fmtInt(basket.length)})` }]}
          />
          <p className="muted small">{coins.length ? coins.map((c) => c.symbol).join('، ') : useBasket ? 'در «شرایط نوسان‌گیری» حالت چند ارز را بزنید و ارز انتخاب کنید.' : 'در حال گرفتن ارزهای پیشنهادی…'}</p>
        </div>
        <div>
          <span className="field-label">سبک</span>
          <Chips label="سبک" value={p.preset} onChange={(v) => setP({ preset: v })} options={(['trend', 'calm', 'normal', 'aggressive'] as const).map((k) => ({ key: k, label: SWING_PRESETS[k].label }))} />
          <small className="muted">{SWING_PRESETS[p.preset].note}</small>
        </div>
        <div>
          <span className="field-label">مدت</span>
          <Chips label="مدت" value={String(p.hours)} onChange={(v) => setP({ hours: Number(v) })} options={HOURS} />
          {p.preset === 'trend' && p.hours < 336 ? <small className="muted">روندسوار هر روز یک بار تصمیم می‌گیرد؛ در جلسه کوتاه ممکن است هیچ معامله‌ای پیش نیاید.</small> : null}
        </div>
        <div>
          <span className="field-label">سرمایه (تومان)</span>
          <Chips label="سرمایه" value={String(p.capital)} onChange={(v) => setP({ capital: Number(v) })} options={CAPS} />
        </div>
      </div>
      <button className="btn run" disabled={busy || !coins.length} onClick={() => act('start')} data-testid="my-swing-go">
        {busy ? 'در حال شروع…' : 'شروع روی همین دستگاه'}
      </button>
      {err ? <p className="empty">{err}</p> : null}
    </section>
  );
}
