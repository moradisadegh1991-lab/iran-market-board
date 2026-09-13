import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import {
  MAX_COINS, MAX_HOURS, MIN_HOURS,
  loadActiveSwing, loadLastFinishedSwing, startSwingSession, stopSwingSession,
  swingHistory, swingUsdtRial, validateSwingConfig,
} from '@/lib/swing-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const [active, lastFinished, history] = await Promise.all([loadActiveSwing(), loadLastFinishedSwing(), swingHistory()]);
    return NextResponse.json(
      { active, lastFinished, history, limits: { maxCoins: MAX_COINS, minHours: MIN_HOURS, maxHours: MAX_HOURS }, serverNow: Date.now() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'رمز مدیر (ADMIN_SECRET) نادرست است.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === 'start') {
      const session = await startSwingSession(validateSwingConfig(body, await swingUsdtRial()));
      return NextResponse.json({ ok: true, session });
    }
    if (body?.action === 'stop') {
      return NextResponse.json({ ok: true, session: await stopSwingSession() });
    }
    return NextResponse.json({ error: 'action نامعتبر است.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
