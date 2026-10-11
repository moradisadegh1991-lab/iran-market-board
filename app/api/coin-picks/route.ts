/**
 * «ارزهای پیشنهادی» (rule 96): the calmest liquid coins the trend rider should trade, with the measured
 * evidence for the rule. Read-only market data; CORS-open for the app (middleware.ts).
 */
import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { coinPicks } from '@/lib/futures-data';
import { PICK_EVIDENCE, PICK_K, PICK_MIN_DAYS, PICK_MIN_VALUE } from '@/lib/engine/coin-pick';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const r = await coinPicks();
    if (!r.picks) throw new Error(r.error ?? 'داده بازار نرسید');
    return NextResponse.json(
      { ...r.picks, stale: r.stale, rule: { k: PICK_K, minDays: PICK_MIN_DAYS, minValue: PICK_MIN_VALUE }, evidence: PICK_EVIDENCE },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
    );
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
