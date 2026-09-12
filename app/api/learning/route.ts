import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import { getLearningState, resetLearning } from '@/lib/learning';
import { paramRows } from '@/lib/engine/learning';
import { DEFAULT_PARAMS } from '@/lib/engine/simulator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const s = await getLearningState();
    return NextResponse.json({ ...s, rows: paramRows(s.params), defaultRows: paramRows(DEFAULT_PARAMS) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

/** POST {action:'reset'} — admin only: back to the original rule set, forget which periods were learned */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'رمز مدیر (ADMIN_SECRET) نادرست است.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'reset') return NextResponse.json({ error: 'action نامعتبر است.' }, { status: 400 });
  try {
    await resetLearning();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
