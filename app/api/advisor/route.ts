import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { ADVISOR_MODEL, advisorSecret, buildMessages, marketContext, SYSTEM_PROMPT, validateAdvisorRequest } from '@/lib/advisor';
import { errMsg } from '@/lib/http';
import { tehranDate } from '@/lib/num';
import { getSnapshot } from '@/lib/snapshot';
import { kv } from '@/lib/store';
import type { Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAILY_LIMIT = Number(process.env.ADVISOR_DAILY_LIMIT || 200);

/** GET → is the advisor configured? (no secret needed; reveals nothing but yes/no) */
export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY && !!advisorSecret(), model: ADVISOR_MODEL });
}

/**
 * POST {summary, messages:[{role,content}…]} with header `x-advisor-secret`.
 * Streams the answer back as plain UTF-8 text. Stateless: nothing the user sends is stored —
 * the only write is a per-day call counter that caps what a leaked secret could cost.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'کلید ANTHROPIC_API_KEY روی سرور (Vercel) تنظیم نشده.' }, { status: 503 });
  }
  const secret = advisorSecret();
  if (!secret) return NextResponse.json({ error: 'ADVISOR_SECRET (یا ADMIN_SECRET) روی سرور تنظیم نشده؛ بدون آن مشاور برای همه باز می‌ماند.' }, { status: 503 });
  if (req.headers.get('x-advisor-secret') !== secret) return NextResponse.json({ error: 'رمز مشاور نادرست است.' }, { status: 403 });

  let parsed;
  try {
    parsed = validateAdvisorRequest(await req.json().catch(() => null));
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }

  const dayKey = `advisor:calls:${tehranDate()}`;
  const used = (await kv.get<number>(dayKey).catch(() => 0)) ?? 0;
  if (used >= DAILY_LIMIT) return NextResponse.json({ error: `سقف ${DAILY_LIMIT.toLocaleString('fa-IR')} پرسش در روز پر شده؛ فردا دوباره امتحان کنید.` }, { status: 429 });
  await kv.set(dayKey, used + 1, 2 * 86_400).catch(() => undefined);

  // the board is usually cached; never let a slow source hold up the answer
  const snap = await Promise.race<Snapshot | null>([getSnapshot().catch(() => null), new Promise((r) => setTimeout(() => r(null), 6_000))]);
  const market = marketContext(snap, Number(process.env.FIXED_INCOME_YIELD || 0.3) * 100);

  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: ADVISOR_MODEL,
    max_tokens: 16_000,
    output_config: { effort: 'medium' },
    // on a safety decline, the API re-runs the turn on a fallback model instead of returning nothing
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    cache_control: { type: 'ephemeral' },
    system: SYSTEM_PROMPT,
    messages: buildMessages(parsed, market),
  });

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') controller.enqueue(enc.encode(ev.delta.text));
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') controller.enqueue(enc.encode('\n\n⚠️ مشاور به این پرسش پاسخ نداد. لطفاً آن را طور دیگری بپرسید.'));
        else if (final.stop_reason === 'max_tokens') controller.enqueue(enc.encode('\n\n… (پاسخ طولانی بود و کوتاه شد)'));
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n⚠️ خطا در ارتباط با مشاور: ${describe(e)}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Advisor-Model': ADVISOR_MODEL } });
}

function describe(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'کلید Anthropic روی سرور نامعتبر است.';
  if (e instanceof Anthropic.RateLimitError) return 'محدودیت نرخ Anthropic؛ چند دقیقه بعد دوباره بپرسید.';
  if (e instanceof Anthropic.BadRequestError) return `درخواست نامعتبر (${e.message})`;
  if (e instanceof Anthropic.APIError) return `خطای ${e.status ?? ''} از Anthropic`;
  return errMsg(e);
}
