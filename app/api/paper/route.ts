import { after, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import { getPaperState, maybeTick, startSession, stopSession, validateConfig } from '@/lib/paper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET → active session (full), last finished session, history. Each visit also nudges a tick if the scheduler is late. */
export async function GET() {
  try {
    const state = await getPaperState();
    after(() => maybeTick());
    return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

/** POST {action:'start', capitalToman, profile, assets, days, reviewEveryDays, useNews} | {action:'stop'} — admin only */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'رمز مدیر (ADMIN_SECRET) نادرست است.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === 'start') {
      const s = await startSession(validateConfig(body));
      return NextResponse.json({ ok: true, session: s });
    }
    if (body?.action === 'stop') {
      const s = await stopSession();
      return NextResponse.json({ ok: true, session: s });
    }
    return NextResponse.json({ error: 'action باید start یا stop باشد.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
