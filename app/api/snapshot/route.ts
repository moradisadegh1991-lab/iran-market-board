import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/snapshot';
import { isAdmin } from '@/lib/auth';
import { errMsg } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1' && isAdmin(req);
  try {
    const snap = await getSnapshot({ force });
    return NextResponse.json(snap, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 503 });
  }
}
