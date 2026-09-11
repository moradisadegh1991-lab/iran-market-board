import { NextResponse } from 'next/server';
import { isCron } from '@/lib/auth';
import { getSnapshot } from '@/lib/snapshot';
import { errMsg } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const s = await getSnapshot({ force: true });
    return NextResponse.json({ ok: true, generatedAt: s.generatedAt, sources: s.sources.map((x) => ({ n: x.name, ok: x.ok, stale: x.stale })), tseHistoryDays: s.stocks.historyDays });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
