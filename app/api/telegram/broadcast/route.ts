import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { broadcast } from '@/lib/telegram/handler';
import { errMsg } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await broadcast({ toSubscribers: body.toSubscribers !== false, toChannel: body.toChannel !== false });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
