import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { getCoverage, runSimulation, validate } from '@/lib/simulate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET → which date range each asset can be simulated on */
export async function GET() {
  try {
    return NextResponse.json(await getCoverage(), { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

/** POST {start, end, capitalToman, profile, assets[], useNews} → full simulation */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'بدنه درخواست JSON معتبر نیست.' }, { status: 400 });
  }
  let input;
  try {
    input = validate(body);
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
  try {
    return NextResponse.json(await runSimulation(input));
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
