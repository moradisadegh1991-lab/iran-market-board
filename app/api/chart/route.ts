import { NextResponse } from 'next/server';
import { getChart, TIMEFRAMES, type Timeframe } from '@/lib/chart';
import { errMsg } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const asset = u.searchParams.get('asset') ?? 'usd';
  const tf = (u.searchParams.get('tf') ?? '1m') as Timeframe;
  if (!TIMEFRAMES.some((t) => t.key === tf)) return NextResponse.json({ error: 'bad tf' }, { status: 400 });
  try {
    const data = await getChart(asset, tf);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
