import { NextResponse } from 'next/server';
import { isCron } from '@/lib/auth';
import { broadcast } from '@/lib/telegram/handler';
import { errMsg } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ ok: false }, { status: 401 });
  if (process.env.DAILY_BROADCAST === '0' || !process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ ok: true, skipped: true });
  try {
    return NextResponse.json({ ok: true, ...(await broadcast()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
