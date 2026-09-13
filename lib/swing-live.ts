// Orchestration for live swing trading: persists the session, fetches real prices each tick,
// and pushes closed trades to Telegram. Ticks come from the same external scheduler as the
// live paper trader (/api/swing-live/tick), plus opportunistically from page visits.
import { kv } from '@/lib/store';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgHourly, fetchCgMarkets, fetchCgMinutely, type CgCoin } from '@/lib/sources/coingecko';
import { getSnapshot } from '@/lib/snapshot';
import { SWING_PRESETS, type SwingPreset } from '@/lib/engine/swing';
import {
  barPlan,
  finishSwingLive,
  startSwingLive,
  swingLiveTick,
  type SwingLiveConfig,
  type SwingLiveInput,
  type SwingLiveSession,
} from '@/lib/engine/swing-live';
import { notifySwingFills, notifySwingFinish, notifySwingStart } from '@/lib/telegram/swing-live';

const ACTIVE_KEY = 'swinglive:active:v1';
const HISTORY_KEY = 'swinglive:history:v1';
const LOCK_KEY = 'swinglive:lock';
const sessionKey = (id: string) => `swinglive:session:v1:${id}`;
const MIN_TICK_GAP_MS = 60_000;
export const MAX_COINS = 6;
export const MIN_HOURS = 1;
export const MAX_HOURS = 168;

export interface SwingLiveHistoryItem {
  id: string;
  startedAt: number;
  finishedAt: number;
  endReason: 'expired' | 'stopped';
  coins: string[];
  hours: number;
  capitalToman: number;
  finalToman: number;
  returnPct: number;
  trades: number;
}

async function withLock<T>(fn: () => Promise<T>, wait = false): Promise<T | null> {
  for (let i = 0; i < (wait ? 30 : 1); i++) {
    if (await kv.setNx(LOCK_KEY, Date.now(), 55)) {
      try {
        return await fn();
      } finally {
        await kv.del(LOCK_KEY).catch(() => undefined);
      }
    }
    if (wait) await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function loadActiveSwing(): Promise<SwingLiveSession | null> {
  const id = await kv.get<string>(ACTIVE_KEY);
  if (!id) return null;
  return (await kv.get<SwingLiveSession>(sessionKey(id))) ?? null;
}

export async function swingHistory(): Promise<SwingLiveHistoryItem[]> {
  return (await kv.get<SwingLiveHistoryItem[]>(HISTORY_KEY)) ?? [];
}

export async function loadLastFinishedSwing(): Promise<SwingLiveSession | null> {
  const h = await swingHistory();
  if (!h.length) return null;
  return (await kv.get<SwingLiveSession>(sessionKey(h[0].id))) ?? null;
}

export function validateSwingConfig(body: any, usdtRial: number | null): SwingLiveConfig {
  const coins = (Array.isArray(body?.coins) ? body.coins : [])
    .map((c: any) => ({ id: String(c?.id ?? '').trim(), symbol: String(c?.symbol ?? c?.id ?? '').toUpperCase(), name: String(c?.name ?? c?.id ?? '') }))
    .filter((c: any) => /^[a-z0-9][a-z0-9-]{1,60}$/.test(c.id));
  const unique = [...new Map(coins.map((c: any) => [c.id, c])).values()] as SwingLiveConfig['coins'];
  if (!unique.length) throw new Error('دست‌کم یک ارز انتخاب کنید.');
  if (unique.length > MAX_COINS) throw new Error(`حداکثر ${MAX_COINS.toLocaleString('fa-IR')} ارز همزمان قابل معامله است.`);

  const capitalToman = Math.round(Number(body?.capitalToman));
  if (!isNum(capitalToman) || capitalToman < 1_000_000 || capitalToman > 1e13) throw new Error('سرمایه باید بین ۱ میلیون تومان و ۱۰ هزار میلیارد تومان باشد.');

  const hours = Math.round(Number(body?.hours));
  if (!isNum(hours) || hours < MIN_HOURS || hours > MAX_HOURS) throw new Error(`مدت باید بین ${MIN_HOURS} و ${MAX_HOURS} ساعت باشد.`);

  const preset = (Object.keys(SWING_PRESETS).includes(body?.preset) ? body.preset : 'normal') as SwingPreset;
  const feePct = isNum(Number(body?.feePct)) ? Math.max(0, Math.min(2, Number(body.feePct))) : 0.4;

  return { coins: unique, capitalToman, preset, feePct, hours, usdtRial };
}

/** Bars plus a spot price for each coin in the session. */
async function gatherInputs(s: SwingLiveSession): Promise<SwingLiveInput[]> {
  const { days, barMinutes } = barPlan(s.config.hours);
  const spot = new Map<string, number>();
  try {
    const mk = await cachedSource<CgCoin[]>('cgMarkets', 300, () => fetchCgMarkets(undefined, 250), 6 * 3600);
    for (const c of mk.data ?? []) if (isNum(c.current_price)) spot.set(c.id, c.current_price);
    const mm = await cachedSource<CgCoin[]>('cgMemes', 300, () => fetchCgMarkets('meme-token', 120), 6 * 3600);
    for (const c of mm.data ?? []) if (isNum(c.current_price)) spot.set(c.id, c.current_price);
  } catch {
    /* spot is a nicety; bars alone still drive the decisions */
  }
  return Promise.all(
    s.config.coins.map(async (coin) => {
      try {
        // short cache: a live session needs fresher bars than a backtest does
        const r = await cachedSource(`swingLiveBars:${coin.id}:${barMinutes}:${days}`, 4 * 60, () => (barMinutes === 5 ? fetchCgMinutely(coin.id) : fetchCgHourly(coin.id, days)), 3 * 3600);
        if (!r.data?.length) throw new Error(r.status.error ?? 'پاسخ خالی');
        return { coin, bars: r.data.map(([t, p]) => ({ t, p })), livePrice: spot.get(coin.id) ?? null };
      } catch (e) {
        return { coin, bars: null, livePrice: null, error: errMsg(e) };
      }
    }),
  );
}

export async function startSwingSession(config: SwingLiveConfig): Promise<SwingLiveSession> {
  const existing = await loadActiveSwing();
  if (existing?.status === 'running') throw new Error('یک نوسان‌گیری برخط در حال اجراست. اول آن را ببندید.');

  // Refuse to start a session whose coins have too little history for the chosen preset —
  // otherwise it would run for hours quietly sitting in cash and look like a broken engine.
  const probe = startSwingLive(config, Date.now());
  const { minBars } = barPlan(config.hours);
  const check = await gatherInputs(probe);
  const thin = check.filter((i) => !i.bars || i.bars.length < minBars);
  if (thin.length === check.length) {
    const why = check.find((i) => i.error)?.error;
    throw new Error(`برای هیچ‌کدام از ارزهای انتخاب‌شده داده کافی دریافت نشد${why ? ` (${why})` : ''}.`);
  }
  if (thin.length) {
    throw new Error(`داده کافی برای ${thin.map((t) => t.coin.symbol).join('، ')} نیست؛ این ارزها را بردارید یا مدت طولانی‌تری انتخاب کنید.`);
  }

  const s = startSwingLive(config, Date.now());
  await kv.set(sessionKey(s.id), s);
  await kv.set(ACTIVE_KEY, s.id);
  notifySwingStart(s).catch(() => undefined);
  // fill in the first tick right away so the page is not empty
  await tickSwingSession({ force: true }).catch(() => undefined);
  return (await loadActiveSwing()) ?? s;
}

async function archive(s: SwingLiveSession) {
  const last = s.equity[s.equity.length - 1]?.equity ?? s.config.capitalToman;
  const item: SwingLiveHistoryItem = {
    id: s.id,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt ?? Date.now(),
    endReason: s.endReason ?? 'stopped',
    coins: s.config.coins.map((c) => c.symbol),
    hours: s.config.hours,
    capitalToman: s.config.capitalToman,
    finalToman: last,
    returnPct: (last / s.config.capitalToman - 1) * 100,
    trades: s.fills.length,
  };
  const hist = await swingHistory();
  await kv.set(HISTORY_KEY, [item, ...hist].slice(0, 20));
  await kv.del(ACTIVE_KEY);
  notifySwingFinish(s).catch(() => undefined);
}

export interface SwingTickReport {
  ran: boolean;
  reason?: 'no-active-session' | 'throttled' | 'locked';
  sessionId?: string;
  fills?: number;
  finished?: boolean;
}

export async function tickSwingSession(opts: { force?: boolean } = {}): Promise<SwingTickReport> {
  const out = await withLock(async () => {
    const s = await loadActiveSwing();
    if (!s || s.status !== 'running') return { ran: false, reason: 'no-active-session' as const };
    const now = Date.now();
    if (!opts.force && s.ticks > 0 && now - s.lastTickAt < MIN_TICK_GAP_MS) {
      return { ran: false, reason: 'throttled' as const, sessionId: s.id };
    }
    const inputs = await gatherInputs(s);
    const { session, newFills } = swingLiveTick(s, inputs, now);
    await kv.set(sessionKey(session.id), session);
    if (newFills.length) notifySwingFills(newFills, session).catch(() => undefined);
    if (session.status === 'finished') await archive(session);
    return { ran: true, sessionId: session.id, fills: newFills.length, finished: session.status === 'finished' };
  });
  return out ?? { ran: false, reason: 'locked' };
}

export async function stopSwingSession(): Promise<SwingLiveSession> {
  const out = await withLock(async () => {
    const s = await loadActiveSwing();
    if (!s || s.status !== 'running') throw new Error('نوسان‌گیری برخط فعالی وجود ندارد.');
    const inputs = await gatherInputs(s);
    const ticked = swingLiveTick(s, inputs, Date.now()).session;
    const done = finishSwingLive(ticked, Date.now(), 'stopped');
    await kv.set(sessionKey(done.id), done);
    await archive(done);
    return done;
  }, true);
  if (!out) throw new Error('نوسان‌گیری برخط مشغول به‌روزرسانی است؛ چند لحظه بعد دوباره تلاش کنید.');
  return out;
}

/** Opportunistic tick from page visits, so a browser open is itself a heartbeat. */
export async function maybeTickSwing(): Promise<void> {
  try {
    const s = await loadActiveSwing();
    if (s?.status === 'running' && Date.now() - s.lastTickAt >= 5 * 60_000) await tickSwingSession();
  } catch {
    /* never let a background tick break a page render */
  }
}

export async function swingUsdtRial(): Promise<number | null> {
  const snap = await getSnapshot();
  const t = snap.live.items.find((i) => i.key === 'usdt')?.price ?? null;
  return isNum(t) ? t * 10 : null;
}
