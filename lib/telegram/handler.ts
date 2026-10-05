import { kv } from '@/lib/store';
import { getSnapshot } from '@/lib/snapshot';
import { baseUrl } from '@/lib/auth';
import { safeSend, tg } from './api';
import { bizCallback, bizContact, startBiz } from './biz';
import { statusMessage } from './paper';
import { getPaperState, NOTIFY_KEY, stopSession } from '@/lib/paper';
import { coinsMsg, fullReport, memesMsg, portfolioMsg, pricesMsg, riskMsg, scenariosMsg, stocksMsg } from './format';
import type { Profile, Snapshot } from '@/lib/types';

export const SUBS_KEY = 'tg:subscribers';

type Route = { match: RegExp; build?: (s: Snapshot) => string[]; special?: 'shops' | 'start' | 'stop' | 'dashboard' | 'help' | 'live' | 'live_on' | 'live_off' | 'live_stop' };
const ROUTES: Route[] = [
  { match: /^\/live_on\b/, special: 'live_on' },
  { match: /^\/live_off\b/, special: 'live_off' },
  { match: /^\/live_stop\b|پایان معامله/, special: 'live_stop' },
  { match: /^\/live\b|معامله برخط/, special: 'live' },
  { match: /^\/shops\b|کسب‌وکارها/, special: 'shops' },
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
  '/live وضعیت معامله برخط · /live_on رمز: دریافت اعلان هر معامله · /live_off لغو اعلان · /live_stop پایان معامله',
  '/stop لغو گزارش روزانه',
  '/shops سفارش و نوبت از کسب‌وکارها',
].join('\n');

export async function handleUpdate(update: any): Promise<void> {
  // «فروشگاه آنلاین» of a business (lib/telegram/biz.ts): buttons, a shared number, a business link
  if (update?.callback_query) {
    await bizCallback(update.callback_query);
    return;
  }
  const msg = update?.message ?? update?.channel_post;
  const chatId = msg?.chat?.id;
  if (chatId && (msg.contact || msg.text === 'انصراف') && (await bizContact(msg))) return;
  const text: string = (msg?.text ?? '').trim();
  if (!chatId || !text) return;
  const bizLink = text.match(/^\/start\s+b_([a-z0-9][a-z0-9-]{2,31})$/);
  if (bizLink) {
    await startBiz(chatId, bizLink[1]);
    return;
  }

  const route = ROUTES.find((r) => r.match.test(text));
  if (!route) {
    await safeSend(chatId, [HELP], true);
    return;
  }
  if (route.special === 'shops') {
    await bizCallback({ id: '', data: 'bz:dir', message: { chat: { id: chatId }, message_id: 0 } });
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
  if (route.special === 'live') {
    const { active } = await getPaperState();
    await safeSend(chatId, [statusMessage(active)], true);
    return;
  }
  if (route.special === 'live_on') {
    const given = text.split(/\s+/)[1] ?? '';
    if (msg?.message_id) await tg('deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {}); // don't leave the secret in the chat
    if (!process.env.ADMIN_SECRET || given !== process.env.ADMIN_SECRET) {
      await safeSend(chatId, ['رمز نادرست است. شکل درست: <code>/live_on ADMIN_SECRET</code>'], true);
      return;
    }
    await kv.sadd(NOTIFY_KEY, String(chatId));
    await safeSend(chatId, ['🔔 اعلان معاملات برخط برای این گفتگو فعال شد. پیام حاوی رمز پاک شد.\nپایان معامله: /live_stop · لغو اعلان: /live_off'], true);
    return;
  }
  if (route.special === 'live_off') {
    await kv.srem(NOTIFY_KEY, String(chatId));
    await safeSend(chatId, ['🔕 اعلان معاملات برخط برای این گفتگو غیرفعال شد.'], true);
    return;
  }
  if (route.special === 'live_stop') {
    const allowed = await kv.smembers(NOTIFY_KEY).catch(() => [] as string[]);
    if (!allowed.includes(String(chatId))) {
      await safeSend(chatId, ['فقط گفتگویی که با <code>/live_on ADMIN_SECRET</code> تأیید شده می‌تواند معامله را پایان دهد.'], true);
      return;
    }
    try {
      await safeSend(chatId, ['⏳ در حال بستن معامله برخط و محاسبه نتیجه…']);
      await stopSession(); // the finish report is sent to every registered chat
    } catch (e) {
      await safeSend(chatId, [`⚠️ ${e instanceof Error ? e.message : 'پایان معامله انجام نشد.'}`], true);
    }
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
