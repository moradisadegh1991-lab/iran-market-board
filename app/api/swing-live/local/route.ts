/**
 * «نوسان‌گیری برخط من» — a live swing session that belongs to the device (rule 13's pattern, rule 97). The
 * server session (/api/swing-live) is one shared run behind ADMIN_SECRET; on the phone each person wants
 * their own. The engine is already pure — every tick replays the backtester over the bars since the
 * session's anchor (lib/engine/swing-live.ts) — so this endpoint just gathers the bars, advances the session
 * the device sent and hands it back. Nothing is stored; nothing goes to Telegram.
 * POST { action: 'start', config } | { action: 'tick'|'stop', session }
 */
import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { barPlan, finishSwingLive, startSwingLive, swingLiveTick, type SwingLiveSession } from '@/lib/engine/swing-live';
import { gatherInputs, LOCAL_MAX_HOURS, swingUsdtRial, validateSwingConfig } from '@/lib/swing-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const MAX_BODY = 2_000_000;

function sane(raw: any): SwingLiveSession {
  if (!raw || typeof raw !== 'object' || (raw.status !== 'running' && raw.status !== 'finished')) throw new Error('جلسه نوسان‌گیری ارسال نشد.');
  const cfg = validateSwingConfig(raw.config, isNum(raw.config?.usdtRial) ? raw.config.usdtRial : null, LOCAL_MAX_HOURS);
  if (raw.config?.engine !== 'v2') throw new Error('جلسه روی گوشی فقط با موتور نسخه ۲ اجرا می‌شود.');
  const num = (v: unknown, d: number) => (isNum(v) ? (v as number) : d);
  const arr = (v: unknown, cap: number) => (Array.isArray(v) ? v.slice(-cap) : []);
  const now = Date.now();
  const startedAt = num(raw.startedAt, now);
  return {
    ...raw,
    config: cfg,
    startedAt,
    endsAt: Math.min(num(raw.endsAt, now), startedAt + LOCAL_MAX_HOURS * 3_600_000),
    finishedAt: isNum(raw.finishedAt) ? raw.finishedAt : null,
    barMinutes: 60,
    sleeveCapitalToman: cfg.capitalToman / cfg.coins.length,
    ticks: Math.max(0, Math.min(100_000, num(raw.ticks, 0))),
    lastTickAt: Math.min(now, num(raw.lastTickAt, now)),
    baseline: raw.baseline && typeof raw.baseline === 'object' ? raw.baseline : {},
    anchor: num(raw.anchor, startedAt),
    tradeFrom: num(raw.tradeFrom, startedAt),
    fills: arr(raw.fills, 2000),
    open: arr(raw.open, 20),
    equity: arr(raw.equity, 600),
    events: Array.isArray(raw.events) ? raw.events.slice(0, 120) : [],
  } as SwingLiveSession;
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new Error('حجم جلسه بیش از حد مجاز است.');
    const body = JSON.parse(text || '{}');
    const action = String(body?.action ?? '');
    const now = Date.now();

    if (action === 'start') {
      const config = { ...validateSwingConfig(body?.config, await swingUsdtRial(), LOCAL_MAX_HOURS), engine: 'v2' as const };
      const s = startSwingLive(config, now);
      s.events[0] = { ...s.events[0], text: `${s.events[0].text} این جلسه فقط روی همین گوشی ذخیره می‌شود و فقط وقتی اپ باز است جلو می‌رود؛ با باز شدن دوباره، کل فاصله از روی کندل‌ها بازپخش می‌شود.` };
      const { inputs, mkt } = await gatherInputs(s);
      const { minBars } = barPlan(config.hours, 'v2');
      const thin = inputs.filter((i) => !i.bars || i.bars.length < minBars);
      if (thin.length === inputs.length) throw new Error(`برای هیچ‌کدام از ارزها داده کافی نرسید${inputs.find((i) => i.error)?.error ? ` (${inputs.find((i) => i.error)!.error})` : ''}.`);
      if (thin.length) throw new Error(`داده کافی برای ${thin.map((t) => t.coin.symbol).join('، ')} نیست؛ این ارزها را بردارید.`);
      const out = swingLiveTick(s, inputs, now, mkt);
      return json({ session: out.session, newFills: [] });
    }

    const s = sane(body?.session);
    if (s.status !== 'running') return json({ session: s, newFills: [] });
    if (action === 'tick' || action === 'stop') {
      const { inputs, mkt } = await gatherInputs(s);
      const out = swingLiveTick(s, inputs, now, mkt);
      const session = action === 'stop' && out.session.status === 'running' ? finishSwingLive(out.session, now, 'stopped') : out.session;
      return json({ session, newFills: out.newFills });
    }
    throw new Error('action نامعتبر است.');
  } catch (e) {
    return json({ error: errMsg(e) }, 400);
  }
}
