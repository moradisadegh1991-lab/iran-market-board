/**
 * Live paper trading that belongs to the device, not to the server.
 *
 * The shared `/api/paper` session lives in Redis: there is exactly one of it, and everyone who
 * opens the site sees the same trader. That is right for the dashboard's own demo and wrong for
 * the phone app, where each person wants their own run with their own capital.
 *
 * The trading engine is already pure — `liveTick` takes a session, applies real quotes to it and
 * hands it back — so the split needs no second engine. This endpoint holds nothing: the device
 * posts its session, gets the advanced session back, and stores it in its own localStorage. Two
 * phones running at once never see each other, and the server keeps no record of either.
 *
 * What the server still supplies is the part a phone cannot: live quotes, several hundred days of
 * daily history, scored news, and the learned parameter set. Those are shared, cached and carry
 * no user data.
 */
import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { getLearnedParams } from '@/lib/learning';
import { ACTIVITY_LABEL, PROFILES, applyActivity, type SimAsset } from '@/lib/engine/simulator';
import { createSession, finishSession, liveTick, type LiveSession } from '@/lib/engine/live';
import { buildContext, scaleParamsForSession, validateConfig } from '@/lib/paper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A device session is the user's own data, but it still arrives over the wire and drives a loop,
 *  so each unbounded field gets a ceiling before the engine sees it. */
const LIMITS = { trades: 2000, equity: 2000, events: 300, pending: 60, newsSeen: 400, exposures: 2000 };
const MAX_BODY = 4_000_000;

function sane(raw: any): LiveSession {
  if (!raw || typeof raw !== 'object') throw new Error('جلسه معامله ارسال نشد.');
  if (raw.status !== 'running' && raw.status !== 'finished') throw new Error('وضعیت جلسه نامعتبر است.');
  const cfg = validateConfig(raw.config); // re-validated every tick: the device could send anything
  const arr = (v: unknown, cap: number) => (Array.isArray(v) ? v.slice(0, cap) : []);
  const num = (v: unknown, dflt: number) => (isNum(v) ? v : dflt);
  const now = Date.now();
  return {
    ...raw,
    config: cfg,
    status: raw.status,
    startedAt: num(raw.startedAt, now),
    endsAt: num(raw.endsAt, now),
    finishedAt: isNum(raw.finishedAt) ? raw.finishedAt : null,
    acct: {
      cash: num(raw.acct?.cash, cfg.capitalToman * 10),
      interestRial: num(raw.acct?.interestRial, 0),
      feesToman: num(raw.acct?.feesToman, 0),
    },
    positions: raw.positions && typeof raw.positions === 'object' ? raw.positions : {},
    cooldown: raw.cooldown && typeof raw.cooldown === 'object' ? raw.cooldown : {},
    pending: arr(raw.pending, LIMITS.pending),
    trades: arr(raw.trades, LIMITS.trades),
    equity: arr(raw.equity, LIMITS.equity),
    exposures: arr(raw.exposures, LIMITS.exposures),
    events: arr(raw.events, LIMITS.events),
    newsSeen: arr(raw.newsSeen, LIMITS.newsSeen),
    newsUse: raw.newsUse && typeof raw.newsUse === 'object' ? raw.newsUse : {},
    startQuotes: raw.startQuotes && typeof raw.startQuotes === 'object' ? raw.startQuotes : {},
    lastQuotes: raw.lastQuotes && typeof raw.lastQuotes === 'object' ? raw.lastQuotes : {},
    startUsd: isNum(raw.startUsd) ? raw.startUsd : null,
    lastTickAt: num(raw.lastTickAt, now),
    ticks: Math.max(0, Math.min(100_000, num(raw.ticks, 0))),
  } as LiveSession;
}

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new Error('حجم جلسه بیش از حد مجاز است.');
    const body = JSON.parse(text || '{}');
    const action = String(body?.action ?? '');
    const now = Date.now();

    if (action === 'start') {
      const config = validateConfig(body?.config);
      const params = applyActivity(scaleParamsForSession(await getLearnedParams(), config.days), config.activity ?? 'normal');
      const s = createSession(now.toString(36) + Math.random().toString(36).slice(2, 6), config, params, now);
      s.events.unshift({
        at: now, kind: 'start',
        text:
          `شروع با ${config.capitalToman.toLocaleString('fa-IR')} تومان، پروفایل ${PROFILES[config.profile].label}، ` +
          `موتور نسخه ${params.version.toLocaleString('fa-IR')}، بازبینی هر ${config.reviewEveryDays.toLocaleString('fa-IR')} روز، ` +
          `سبک ${ACTIVITY_LABEL[config.activity ?? 'normal']}. این جلسه فقط روی همین گوشی ذخیره می‌شود.`,
      });
      // first review immediately, so the session does not sit idle until the next app open
      const ctx = await buildContext(now, config.assets, config.useNews);
      const out = liveTick(s, ctx);
      if (ctx.dataNote) s.events.unshift({ at: now, kind: 'data', text: ctx.dataNote });
      return NextResponse.json({ session: s, newTrades: out.newTrades, newEvents: out.newEvents, finished: out.finished }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'tick') {
      const s = sane(body?.session);
      if (s.status !== 'running') return NextResponse.json({ session: s, newTrades: [], newEvents: [], finished: true }, { headers: { 'Cache-Control': 'no-store' } });
      const ctx = await buildContext(now, s.config.assets, s.config.useNews);
      const prevNote = s.events.find((e) => e.kind === 'data')?.text;
      const out = liveTick(s, ctx);
      if (ctx.dataNote && ctx.dataNote !== prevNote) s.events.unshift({ at: now, kind: 'data', text: ctx.dataNote });
      return NextResponse.json({ session: s, newTrades: out.newTrades, newEvents: out.newEvents, finished: out.finished }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'stop') {
      const s = sane(body?.session);
      if (s.status !== 'running') return NextResponse.json({ session: s, newTrades: [], newEvents: [], finished: true }, { headers: { 'Cache-Control': 'no-store' } });
      // one last look at live prices so the closing valuation is current (may also fire a due stop)
      const newTrades = [];
      try {
        const ctx = await buildContext(now, s.config.assets, false);
        const out = liveTick(s, { ...ctx, news: [] });
        newTrades.push(...out.newTrades);
      } catch (e) {
        s.events.unshift({ at: now, kind: 'data', text: `دریافت قیمت پایانی ممکن نشد (${errMsg(e)})؛ آخرین قیمت‌های ثبت‌شده استفاده شد.` });
      }
      if (s.status === 'running') finishSession(s, 'stopped', { now: Date.now() });
      return NextResponse.json({ session: s, newTrades, newEvents: [], finished: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    throw new Error('action نامعتبر است.');
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}

/** The asset menu, so the app does not have to hard-code it and drift from the engine. */
export async function GET() {
  const { SIM_ASSETS } = await import('@/lib/engine/simulator');
  return NextResponse.json({
    assets: SIM_ASSETS.map((a) => ({ key: a.key as SimAsset, label: a.label, unit: a.unit, crypto: a.crypto, costNote: a.costNote })),
    profiles: Object.entries(PROFILES).map(([key, p]) => ({ key, label: p.label })),
    activities: Object.entries(ACTIVITY_LABEL).map(([key, label]) => ({ key, label })),
  });
}
