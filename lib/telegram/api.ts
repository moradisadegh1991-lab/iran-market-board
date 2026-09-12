import { createHash } from 'node:crypto';
import { errMsg } from '@/lib/http';

const token = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return t;
};

/**
 * Telegram only accepts secret_token matching [A-Za-z0-9_-]{1,256}.
 * If the env value is clean it's used as-is; otherwise (stray quotes, spaces, Persian chars …)
 * we derive a valid token from its SHA-256. setup and webhook both call this, so they always agree.
 */
export function webhookSecret(): string | null {
  const raw = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (/^[A-Za-z0-9_-]{1,256}$/.test(trimmed)) return trimmed;
  return createHash('sha256').update(raw).digest('hex');
}

export async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(`${method}: ${json.description ?? 'failed'}`);
  return json.result;
}

export const MENU = [
  ['💱 قیمت‌ها', '🎯 سناریوها'],
  ['⚠️ ریسک بازارها', '🧺 سبد دارایی'],
  ['🪙 ۱۰ کوین', '🐸 ۱۰ میم‌کوین'],
  ['📈 ۱۰ سهم', '🌐 داشبورد'],
  ['📋 گزارش کامل', '🤖 معامله برخط'],
];

export const replyKeyboard = { keyboard: MENU.map((row) => row.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true };

export async function sendMessages(chatId: string | number, messages: string[], withKeyboard = false): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: messages[i],
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(withKeyboard && i === messages.length - 1 ? { reply_markup: replyKeyboard } : {}),
    });
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 120));
  }
}

export async function safeSend(chatId: string | number, messages: string[], withKeyboard = false): Promise<string | null> {
  try {
    await sendMessages(chatId, messages, withKeyboard);
    return null;
  } catch (e) {
    return errMsg(e);
  }
}
