// Heartbeat for live paper trading. Call every 5–10 minutes from an external scheduler:
//   GitHub Actions (.github/workflows/paper-tick.yml) with header  Authorization: Bearer CRON_SECRET
//   or cron-job.org with  ?secret=ADMIN_SECRET
import { NextResponse } from 'next/server';
import { isAdmin, isCron } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import { tickActive } from '@/lib/paper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCron(req) && !isAdmin(req)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await tickActive()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
