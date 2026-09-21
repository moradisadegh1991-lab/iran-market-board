// Orchestration for live paper trading: builds tick context from real data, persists the session, learns at the end,
// and pushes every trade to Telegram. Ticks come from an external scheduler (GitHub Actions / cron-job.org),
// the daily Vercel cron, and opportunistically from dashboard visits and bot messages.
import { kv } from '@/lib/store';
import { errMsg } from '@/lib/http';
import { isNum, tehranDate } from '@/lib/num';
import { getSnapshot } from '@/lib/snapshot';
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgMarkets } from '@/lib/sources/coingecko';
import { loadNews } from '@/lib/news';
import { loadAllSeries } from '@/lib/simulate';
import { applyLearning, getLearnedParams, lookupFromSeries } from '@/lib/learning';
import { ACTIVITY_LABEL, SIM_ASSETS, PROFILES, applyActivity, type ScoredNews, type SimAsset, type SimParams, type SimResult } from '@/lib/engine/simulator';
import type { LearnOutcome } from '@/lib/engine/learning';
import { createSession, finishSession, liveTick, type LiveConfig, type LiveSession, type LiveTrade, type TickContext } from '@/lib/engine/live';
import { notifyFinish, notifyStart, notifyTrades } from '@/lib/telegram/paper';

const ACTIVE_KEY = 'paper:active:v1';
const HISTORY_KEY = 'paper:history:v1';
const LOCK_KEY = 'paper:lock';
export const NOTIFY_KEY = 'paper:notify';
const sessionKey = (id: string) => `paper:session:v1:${id}`;
const MIN_TICK_GAP_MS = 4 * 60_000;
const DAY = 86400000;

export interface PaperHistoryItem {
  id: string;
  startedAt: number;
  finishedAt: number;
  endReason: 'expired' | 'stopped';
  profile: LiveConfig['profile'];
  assets: SimAsset[];
  capitalToman: number;
  finalToman: number;
  returnPct: number;
  depositReturnPct: number | null;
  trades: number;
  paramsVersion: number;
  learning: { applied: boolean; toVersion: number; reason: string | null; lessons: string[] } | null;
}

export type StoredSession = LiveSession & { learning: LearnOutcome | null };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

async function withPaperLock<T>(fn: () => Promise<T>, wait = false): Promise<T | null> {
  for (let i = 0; i < (wait ? 40 : 1); i++) {
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

async function loadActive(): Promise<StoredSession | null> {
  const id = await kv.get<string>(ACTIVE_KEY);
  if (!id) return null;
  return kv.get<StoredSession>(sessionKey(id));
}

const save = (s: StoredSession) => kv.set(sessionKey(s.id), s, 120 * 86400);

/** Real quotes (rial per unit; TSE in index points like the backtest) + daily history + recent news. */
export async function buildContext(now: number, assets: SimAsset[], useNews: boolean): Promise<TickContext & { dataNote: string | null }> {
  const [snap, all] = await Promise.all([getSnapshot(), loadAllSeries()]);
  const item = (k: string) => snap.live.items.find((i) => i.key === k)?.price ?? null;
  const usdRial = isNum(item('usd')) ? item('usd')! * 10 : null;
  const quotes: Partial<Record<SimAsset, number>> = {};
  const q = (a: SimAsset, v: number | null) => {
    if (isNum(v) && v > 0) quotes[a] = v;
  };
  q('usd', usdRial);
  q('g18', isNum(item('g18')) ? item('g18')! * 10 : null);
  q('coin', isNum(item('coin')) ? item('coin')! * 10 : null);
  q('tse', item('tse'));
  q('btc', isNum(item('btc')) && isNum(usdRial) ? item('btc')! * usdRial : null);
  q('eth', isNum(item('eth')) && isNum(usdRial) ? item('eth')! * usdRial : null);
  // Altcoins aren't on the rate board. Their live dollar price comes from the full cached
  // CoinGecko market list — NOT from snap.crypto (that is only this week's top-10 picks, so a
  // coin outside the picks would silently have no quote and could never trade).
  // Matched by CoinGecko id, not ticker, so a same-symbol clone can't be picked up by mistake.
  if (isNum(usdRial)) {
    const [mk, mm] = await Promise.all([
      cachedSource<{ id: string; current_price: number }[]>('cgMarkets', 300, () => fetchCgMarkets(undefined, 250), 6 * 3600).catch(() => null),
      cachedSource<{ id: string; current_price: number }[]>('cgMemes', 300, () => fetchCgMarkets('meme-token', 120), 6 * 3600).catch(() => null),
    ]);
    const cg = new Map<string, number>();
    for (const c of [...(mk?.data ?? []), ...(mm?.data ?? [])]) if (c?.id && isNum(c.current_price)) cg.set(c.id, c.current_price);
    // last resort: the screener rows, which carry a price too
    for (const c of [...snap.crypto.coins, ...snap.crypto.memes]) if (!cg.has(c.id) && isNum(c.price)) cg.set(c.id, c.price);
    for (const a of SIM_ASSETS) {
      if (!a.crypto || !a.cg || a.key === 'btc' || a.key === 'eth') continue;
      const usd = cg.get(a.cg);
      q(a.key, isNum(usd) ? usd! * usdRial : null);
    }
  }

  let news: ScoredNews[] = [];
  let dataNote: string | null = null;
  if (useNews) {
    const today = tehranDate(new Date(now));
    const r = await cachedSource(
      'paperNews',
      3 * 3600,
      async () => (await loadNews(addDays(today, -10), today, assets, Date.now() + 15_000)).items,
      24 * 3600,
    ).catch(() => null);
    news = r?.data ?? [];
    if (!r?.status.ok) dataNote = 'اخبار این بررسی در دسترس نبود؛ تصمیم‌ها فقط بر پایه قیمت گرفته شد.';
  }
  const missing = assets.filter((a) => !isNum(quotes[a]));
  if (missing.length) dataNote = [dataNote, `قیمت زنده ${missing.map((a) => SIM_ASSETS.find((x) => x.key === a)!.label).join('، ')} در این بررسی دریافت نشد.`].filter(Boolean).join(' ');

  return {
    now, quotes, usdRial, news, dataNote,
    daily: Object.fromEntries(Object.entries(all.series).map(([k, s]) => [k, { dates: s!.dates, prices: s!.prices }])),
    ons: { dates: all.ons.dates, prices: all.ons.prices },
    usdRef: { dates: all.usd.dates, prices: all.usd.prices },
  };
}

async function archive(s: StoredSession, fullResult: SimResult) {
  let learning: LearnOutcome | null = null;
  try {
    const all = await loadAllSeries();
    learning = await applyLearning(fullResult, lookupFromSeries(all.series), 'live', `معامله برخط ${PROFILES[s.config.profile].label}`);
  } catch (e) {
    s.events.unshift({ at: Date.now(), kind: 'data', text: `یادگیری از نتیجه انجام نشد: ${errMsg(e)}` });
  }
  s.learning = learning;
  await save(s);
  const hist = (await kv.get<PaperHistoryItem[]>(HISTORY_KEY)) ?? [];
  const m = fullResult.metrics;
  hist.unshift({
    id: s.id, startedAt: s.startedAt, finishedAt: s.finishedAt!, endReason: s.endReason!, profile: s.config.profile, assets: s.config.assets,
    capitalToman: s.config.capitalToman, finalToman: m.finalEquity, returnPct: m.returnPct,
    depositReturnPct: fullResult.benchmarks.find((b) => b.key === 'deposit')?.returnPct ?? null,
    trades: m.trades, paramsVersion: s.params.version,
    learning: learning ? { applied: learning.applied, toVersion: learning.after.version, reason: learning.reason, lessons: learning.lessons.map((l) => l.title) } : null,
  });
  await kv.set(HISTORY_KEY, hist.slice(0, 30));
  await kv.del(ACTIVE_KEY);
  await notifyFinish(s, fullResult, learning);
}

export interface TickReport {
  ran: boolean;
  reason?: string;
  trades?: number;
  finished?: boolean;
  sessionId?: string;
}

/** One tick of the active session. Safe to call often: throttled and locked. */
export async function tickActive(opts: { force?: boolean } = {}): Promise<TickReport> {
  const report = await withPaperLock(async (): Promise<TickReport> => {
    const s = await loadActive();
    if (!s || s.status !== 'running') return { ran: false, reason: 'no-active-session' };
    const now = Date.now();
    if (!opts.force && s.ticks > 0 && now - s.lastTickAt < MIN_TICK_GAP_MS) return { ran: false, reason: 'throttled', sessionId: s.id };
    const ctx = await buildContext(now, s.config.assets, s.config.useNews);
    const prevNote = s.events.find((e) => e.kind === 'data')?.text;
    const out = liveTick(s, ctx);
    if (ctx.dataNote && ctx.dataNote !== prevNote) s.events.unshift({ at: now, kind: 'data', text: ctx.dataNote });
    await save(s);
    if (out.newTrades.length) await notifyTrades(s, out.newTrades);
    if (out.finished && s.result) await archive(s, { ...s.result, equity: s.equity });
    return { ran: true, trades: out.newTrades.length, finished: out.finished, sessionId: s.id };
  });
  return report ?? { ran: false, reason: 'locked' };
}

/** Fire-and-forget helper for page views and bot messages. */
export async function maybeTick(): Promise<void> {
  try {
    const id = await kv.get<string>(ACTIVE_KEY);
    if (!id) return;
    const s = await kv.get<StoredSession>(sessionKey(id));
    if (s?.status === 'running' && Date.now() - s.lastTickAt >= 8 * 60_000) await tickActive();
  } catch {
    /* opportunistic only */
  }
}

export function validateConfig(body: any): LiveConfig {
  const valid = SIM_ASSETS.map((a) => a.key);
  const assets = [...new Set((Array.isArray(body?.assets) ? body.assets : []).filter((a: string) => valid.includes(a as SimAsset)))] as SimAsset[];
  if (!assets.length) throw new Error('دست‌کم یک دارایی انتخاب کنید.');
  const capitalToman = Math.round(Number(body?.capitalToman));
  if (!isNum(capitalToman) || capitalToman < 1_000_000 || capitalToman > 1e13) throw new Error('سرمایه باید بین ۱ میلیون تومان و ۱۰ هزار میلیارد تومان باشد.');
  const days = Math.round(Number(body?.days ?? 30));
  if (!isNum(days) || days < 1 || days > 90) throw new Error('مدت معامله باید بین ۱ و ۹۰ روز باشد.');
  const profile = (Object.keys(PROFILES).includes(body?.profile) ? body.profile : 'balanced') as LiveConfig['profile'];
  // The weekly rhythm is inherited from the backtest, where a run spans months. On a live
  // session it meant a one-week session got exactly ONE decision point — at the start — and
  // then sat still until it expired. Default it to the session length instead, aiming for
  // roughly six decision points, and still allow an explicit choice.
  const asked = Number(body?.reviewEveryDays);
  const reviewEveryDays = [1, 2, 3, 7].includes(asked) ? asked : Math.max(1, Math.min(7, Math.floor(days / 6) || 1));
  const activity = (['calm', 'normal', 'active'] as const).includes(body?.activity) ? body.activity : 'normal';
  return { capitalToman, profile, assets, days, reviewEveryDays, activity, fixedIncomeYield: Number(process.env.FIXED_INCOME_YIELD || 0.3), useNews: body?.useNews !== false };
}

/**
 * The engine's hold and cooldown rules are written for multi-month backtests. Left as-is on a
 * short live session they silently forbid any second trade: a 7-day session with a 10-day
 * cooldown can never re-enter after a sell, and a 5-day minimum hold consumes most of it.
 * Scale them to the session, with floors so a short session doesn't become hair-triggered.
 */
export function scaleParamsForSession(params: SimParams, days: number): SimParams {
  const scale = Math.max(0.2, Math.min(1, days / 45));
  if (scale >= 1) return params;
  return {
    ...params,
    minHoldDays: Math.max(1, params.minHoldDays * scale),
    cooldownDays: Math.max(1, params.cooldownDays * scale),
  };
}

export async function startSession(config: LiveConfig): Promise<StoredSession> {
  const created = await withPaperLock(async () => {
    const existing = await loadActive();
    if (existing?.status === 'running') throw new Error('یک معامله برخط در حال اجراست؛ ابتدا آن را پایان دهید.');
    const now = Date.now();
    const params = applyActivity(scaleParamsForSession(await getLearnedParams(), config.days), config.activity ?? 'normal');
    const s: StoredSession = { ...createSession(now.toString(36), config, params, now), learning: null };
    s.events.unshift({
      at: now, kind: 'start',
      text:
        `شروع با ${config.capitalToman.toLocaleString('fa-IR')} تومان، پروفایل ${PROFILES[config.profile].label}، ` +
        `موتور نسخه ${params.version.toLocaleString('fa-IR')}، بازبینی هر ${config.reviewEveryDays.toLocaleString('fa-IR')} روز، ` +
        `سبک ${ACTIVITY_LABEL[config.activity ?? 'normal']}، حداقل نگه‌داری ${Math.round(params.minHoldDays).toLocaleString('fa-IR')} و فاصله ورود مجدد ${Math.round(params.cooldownDays).toLocaleString('fa-IR')} روز.`,
    });
    await save(s);
    await kv.set(ACTIVE_KEY, s.id);
    return s;
  }, true);
  if (!created) throw new Error('سیستم مشغول است؛ چند ثانیه بعد دوباره تلاش کنید.');
  await notifyStart(created);
  await tickActive({ force: true }); // first review right away
  return (await kv.get<StoredSession>(sessionKey(created.id))) ?? created;
}

export async function stopSession(): Promise<StoredSession> {
  const done = await withPaperLock(async () => {
    const s = await loadActive();
    if (!s || s.status !== 'running') throw new Error('معامله برخط فعالی وجود ندارد.');
    const now = Date.now();
    // last look at live prices so the final valuation is current (a tick may also execute a due stop)
    try {
      const ctx = await buildContext(now, s.config.assets, false);
      const out = liveTick(s, { ...ctx, news: [] });
      if (out.newTrades.length) await notifyTrades(s, out.newTrades);
    } catch (e) {
      s.events.unshift({ at: now, kind: 'data', text: `دریافت قیمت پایانی ممکن نشد (${errMsg(e)})؛ آخرین قیمت‌های ثبت‌شده استفاده شد.` });
    }
    const full = s.status === 'running' ? finishSession(s, 'stopped', { now: Date.now() }) : { ...s.result!, equity: s.equity };
    await save(s);
    await archive(s, { ...full, equity: s.equity });
    return s;
  }, true);
  if (!done) throw new Error('سیستم مشغول است؛ چند ثانیه بعد دوباره تلاش کنید.');
  return done;
}

export async function getPaperState() {
  const [active, history, notify] = await Promise.all([loadActive(), kv.get<PaperHistoryItem[]>(HISTORY_KEY), kv.smembers(NOTIFY_KEY).catch(() => [])]);
  const lastFinishedId = history?.[0]?.id;
  const lastFinished = !active && lastFinishedId ? await kv.get<StoredSession>(sessionKey(lastFinishedId)) : null;
  return { active, lastFinished, history: history ?? [], notifyChats: notify.length, serverNow: Date.now() };
}

export type { LiveTrade };
