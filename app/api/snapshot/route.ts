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
    // every open page and app polls this once a minute: let Vercel's CDN answer most of them (the board itself is
    // rebuilt at most once a minute anyway), so they cost neither a function run nor Redis
    return NextResponse.json(snap, { headers: { 'Cache-Control': force ? 'no-store' : 'public, max-age=0, s-maxage=30, stale-while-revalidate=60' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 503 });
  }
}
