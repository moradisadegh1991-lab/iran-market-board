import { NextResponse } from 'next/server';
import { baseUrl, isAdmin } from '@/lib/auth';
import { tg, webhookSecret } from '@/lib/telegram/api';
import { errMsg } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const secret = webhookSecret();
  if (!secret) return NextResponse.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is not set' }, { status: 400 });
  try {
    const url = `${baseUrl(req)}/api/telegram/webhook`;
    await tg('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'channel_post'], drop_pending_updates: true });
    await tg('setMyCommands', {
      commands: [
        { command: 'prices', description: 'قیمت لحظه‌ای' },
        { command: 'scenarios', description: 'بدترین و بهترین سناریوی قیمت' },
        { command: 'risk', description: 'ریسک خرید، نگهداری و فروش' },
        { command: 'crypto', description: '۱۰ کوین با مومنتوم قوی' },
        { command: 'meme', description: '۱۰ میم‌کوین با مومنتوم قوی' },
        { command: 'stocks', description: '۱۰ سهم بورس و فرابورس' },
        { command: 'portfolio', description: 'سبد پیشنهادی' },
        { command: 'all', description: 'گزارش کامل' },
        { command: 'stop', description: 'لغو گزارش روزانه' },
      ],
    });
    const info = await tg('getWebhookInfo', {});
    return NextResponse.json({ ok: true, webhook: url, info });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
