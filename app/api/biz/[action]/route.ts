import { NextResponse } from 'next/server';
import { getCatalog, publish, pull, refState, setRefStatus, submit, unpublish, waitingTimes } from '@/lib/biz/server';
import { botUsername, tellCustomer } from '@/lib/telegram/biz';

/**
 * «فروشگاه آنلاین» (rule 80). Owner calls carry the slug's token: publish · unpublish · inbox · status.
 * Customer calls are open, checked and rate-limited: public · order · book · track.
 * CORS is open for these paths (middleware.ts) so the app can call them.
 */
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
const out = (r: { ok: boolean; status?: number } & Record<string, unknown>) => {
  const { status, ...rest } = r;
  return json(rest, r.ok ? 200 : (status as number) || 400);
};

export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const u = new URL(req.url);
  const slug = (u.searchParams.get('slug') ?? u.searchParams.get('b') ?? '').toLowerCase();
  if (action === 'public') {
    const catalog = await getCatalog(slug);
    if (!catalog) return json({ ok: false, error: 'این کسب‌وکار پیدا نشد یا صفحه آنلاینش خاموش است.' }, 404);
    return json({ ok: true, catalog, waiting: await waitingTimes(slug), bot: await botUsername() });
  }
  if (action === 'track') {
    const st = await refState(slug, (u.searchParams.get('id') ?? '').toUpperCase());
    // what the customer needs and nothing else (no chat id)
    return st ? json({ ok: true, kind: st.kind, status: st.status, summary: st.summary }) : json({ ok: false, error: 'کد پیگیری پیدا نشد.' }, 404);
  }
  if (action === 'bot') return json({ ok: true, bot: await botUsername() });
  return json({ ok: false, error: 'not found' }, 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'بدنه نامعتبر است.' }, 400);
  if (JSON.stringify(body).length > 400_000) return json({ ok: false, error: 'خیلی بزرگ است.' }, 413);
  const slug = String(body.slug ?? '').toLowerCase();
  const now = Date.now();
  switch (action) {
    case 'publish': {
      const r = await publish(slug, body.token, body.catalog, now);
      return out(r.ok ? { ...r, bot: await botUsername() } : r);
    }
    case 'unpublish':
      return out(await unpublish(slug, body.token));
    case 'inbox':
      return out(await pull(slug, body.token, body.ack));
    case 'status': {
      const id = String(body.id ?? '').toUpperCase();
      const r = await setRefStatus(slug, body.token, id, String(body.status ?? ''));
      if (r.ok && r.chat && r.state) {
        const cat = await getCatalog(slug);
        await tellCustomer(r.chat, cat?.name ?? slug, id, r.state.kind, r.state.status);
      }
      return out(r.ok ? { ok: true } : r);
    }
    case 'order':
    case 'book': {
      const r = await submit(slug, action === 'order' ? 'order' : 'booking', body, 'web', ipOf(req), now);
      return out(r.ok ? { ok: true, id: r.id } : r);
    }
  }
  return json({ ok: false, error: 'not found' }, 404);
}
