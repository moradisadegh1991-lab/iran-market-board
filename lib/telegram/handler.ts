import { kv } from '@/lib/store';
import { getSnapshot } from '@/lib/snapshot';
import { baseUrl } from '@/lib/auth';
import { safeSend, tg } from './api';
import { coinsMsg, fullReport, memesMsg, portfolioMsg, pricesMsg, riskMsg, scenariosMsg, stocksMsg } from './format';
import type { Profile, Snapshot } from '@/lib/types';

export const SUBS_KEY = 'tg:subscribers';

type Route = { match: RegExp; build?: (s: Snapshot) => string[]; special?: 'start' | 'stop' | 'dashboard' | 'help' };
const ROUTES: Route[] = [
  { match: /^\/start/, special: 'start' },
  { match: /^\/stop/, special: 'stop' },
  { match: /^\/(help)|راهنما/, special: 'help' },
  { match: /^\/prices|قیمت/, build: pricesMsg },
  { match: /^\/scenarios|سناریو/, build: scenariosMsg },
  { match: /^\/risk|ریسک/, build: riskMsg },
  { match: /^\/meme|میم/, build: memesMsg },
  { match: /^\/crypto|کوین/, build: coinsMsg },
  { match: /^\/stocks|سهم|بورس/, build: stocksMsg },
  { match: /^\/portfolio_safe|محتاط/, build: (s) => portfolioMsg(s, 'conservative') },
  { match: /^\/portfolio_bold|جسور/, build: (s) => portfolioMsg(s, 'aggressive') },
  { match: /^\/portfolio|سبد/, build: (s) => portfolioMsg(s) },
  { match: /^\/all|گزارش/, build: fullReport },
  { match: /^\/dashboard|داشبورد/, special: 'dashboard' },
];

const HELP = [
  '<b>راهنمای ربات تابلوی بازار</b>',
  '/prices قیمت لحظه‌ای',
  '/scenarios بدترین و بهترین سناریوی قیمت در ۶ افق',
  '/risk ریسک خرید، نگهداری و فروش در ۶ افق',
  '/crypto ده کوین با مومنتوم قوی',
  '/meme ده میم‌کوین با مومنتوم قوی',
  '/stocks ده سهم بورس و فرابورس',
  '/portfolio سبد متعادل · /portfolio_safe محتاط · /portfolio_bold جسور',
  '/all گزارش کامل',
  '/stop لغو گزارش روزانه',
].join('\n');

export async function handleUpdate(update: any): Promise<void> {
  const msg = update?.message ?? update?.channel_post;
  const chatId = msg?.chat?.id;
  const text: string = (msg?.text ?? '').trim();
  if (!chatId || !text) return;

  const route = ROUTES.find((r) => r.match.test(text));
  if (!route) {
    await safeSend(chatId, [HELP], true);
    return;
  }
  if (route.special === 'start') {
    await kv.sadd(SUBS_KEY, String(chatId));
    await safeSend(chatId, ['👋 به ربات تابلوی بازار خوش آمدید. گزارش روزانه برای شما فعال شد.\n\n' + HELP], true);
    return;
  }
  if (route.special === 'stop') {
    await kv.srem(SUBS_KEY, String(chatId));
    await safeSend(chatId, ['گزارش روزانه غیرفعال شد. برای فعال‌سازی دوباره /start را بفرستید.'], true);
    return;
  }
  if (route.special === 'help') {
    await safeSend(chatId, [HELP], true);
    return;
  }
  if (route.special === 'dashboard') {
    await safeSend(chatId, [`🌐 داشبورد زنده:\n${baseUrl()}`], true);
    return;
  }
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  try {
    const snap = await getSnapshot();
    await safeSend(chatId, route.build!(snap), true);
  } catch {
    await safeSend(chatId, ['⚠️ داده‌ها موقتاً در دسترس نیست. چند دقیقه بعد دوباره تلاش کنید.'], true);
  }
}

export async function broadcast(opts: { toSubscribers?: boolean; toChannel?: boolean; profile?: Profile } = {}) {
  const snap = await getSnapshot({ force: true });
  const messages = fullReport(snap);
  const targets: string[] = [];
  if (opts.toChannel !== false && process.env.TELEGRAM_CHANNEL_ID) targets.push(process.env.TELEGRAM_CHANNEL_ID);
  if (opts.toSubscribers !== false) targets.push(...(await kv.smembers(SUBS_KEY)));
  const results: { chat: string; error: string | null }[] = [];
  for (const chat of [...new Set(targets)]) {
    const error = await safeSend(chat, messages);
    results.push({ chat, error });
    if (error && /blocked|chat not found|deactivated/i.test(error)) await kv.srem(SUBS_KEY, chat);
  }
  return { messages: messages.length, sent: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error) };
}
