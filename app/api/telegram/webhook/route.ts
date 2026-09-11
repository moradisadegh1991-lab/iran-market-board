import { after, NextResponse } from 'next/server';
import { handleUpdate } from '@/lib/telegram/handler';
import { webhookSecret } from '@/lib/telegram/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  if (update) after(() => handleUpdate(update));
  return NextResponse.json({ ok: true });
}
