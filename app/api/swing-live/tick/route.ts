import { NextResponse } from 'next/server';
import { isAdmin, isCron } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import { tickSwingSession } from '@/lib/swing-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Heartbeat for live swing sessions. Accepts the cron bearer token or ADMIN_SECRET. */
export async function GET(req: Request) {
  if (!isCron(req) && !isAdmin(req)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await tickSwingSession()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
