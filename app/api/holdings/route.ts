import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import { INSTRUMENTS, KIND_LABEL, KIND_QTY_LABEL, addHolding, removeHolding, valueHoldings } from '@/lib/holdings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET → holdings valued at live prices, plus the instrument menu for the add form. */
export async function GET() {
  try {
    const summary = await valueHoldings();
    return NextResponse.json(
      { ...summary, instruments: INSTRUMENTS, kindLabel: KIND_LABEL, kindQtyLabel: KIND_QTY_LABEL },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

/** POST {action:'add', instrument, qty, paidToman, boughtOn, note} | {action:'remove', id} — admin only */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'رمز مدیر (ADMIN_SECRET) نادرست است.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === 'add') {
      await addHolding(body);
      return NextResponse.json({ ok: true, ...(await valueHoldings()) });
    }
    if (body?.action === 'remove') {
      await removeHolding(String(body?.id ?? ''));
      return NextResponse.json({ ok: true, ...(await valueHoldings()) });
    }
    return NextResponse.json({ error: 'action باید add یا remove باشد.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
