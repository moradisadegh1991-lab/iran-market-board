import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { errMsg } from '@/lib/http';
import { INSTRUMENTS, KIND_LABEL, KIND_QTY_LABEL, addHolding, removeHolding, valueHoldings } from '@/lib/holdings';
import { HORIZON_LABEL, analyzeHoldings } from '@/lib/engine/holdings-analysis';
import { getSnapshot } from '@/lib/snapshot';
import type { PortfolioHorizon, Profile } from '@/lib/types';

const PROFILES = new Set(['conservative', 'balanced', 'aggressive']);
const HORIZONS = new Set(['m1', 'm3', 'm6', 'y1']);

/** Value the holdings and attach entry-timing / risk / portfolio-match analysis. */
async function summaryWithAnalysis(url?: string) {
  const summary = await valueHoldings();
  const q = url ? new URL(url).searchParams : null;
  const profileRaw = q?.get('profile') ?? '';
  const horizonRaw = q?.get('horizon') ?? '';
  const profile = PROFILES.has(profileRaw) ? (profileRaw as Profile) : undefined;
  const horizon = HORIZONS.has(horizonRaw) ? (horizonRaw as PortfolioHorizon) : undefined;
  const snap = await getSnapshot();
  const analysis = await analyzeHoldings(summary.items, snap, { profile, horizon, totalValue: summary.totalValueToman });
  return { ...summary, analysis, horizonLabel: HORIZON_LABEL, profile: profile ?? snap.defaultProfile, horizon: horizon ?? 'm3' };
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET → holdings valued at live prices, plus the instrument menu for the add form. */
export async function GET(req: Request) {
  try {
    const summary = await summaryWithAnalysis(req.url);
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
      return NextResponse.json({ ok: true, ...(await summaryWithAnalysis()) });
    }
    if (body?.action === 'remove') {
      await removeHolding(String(body?.id ?? ''));
      return NextResponse.json({ ok: true, ...(await summaryWithAnalysis()) });
    }
    return NextResponse.json({ error: 'action باید add یا remove باشد.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
