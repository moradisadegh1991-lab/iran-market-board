// The Telegram face of «فروشگاه آنلاین» (Kasbai's bot, on this site's own bot): a customer opens
// t.me/<bot>?start=b_<slug>, sees the business, orders from the menu or books a time with buttons,
// and shares their number with Telegram's own «send my number» button. What they send goes to the
// same inbox as the public page (lib/biz/server.ts); the owner's phone collects it, and when the
// owner confirms or cancels, this bot tells the customer.

import { kv } from '@/lib/store';
import { baseUrl } from '@/lib/auth';
import { calendarOfCatalog, whenFa, type PublicCatalog } from '@/lib/biz/public';
import { directory, getCatalog, refState, submit, waitingTimes } from '@/lib/biz/server';
import { availableSlots, tehranParts, tehranMs, weekdayOf } from '@/lib/biz/slots';
import { tg } from './api';

type Btn = { text: string; callback_data?: string; url?: string };
interface Session {
  slug: string;
  cart: Record<string, number>;
  svc: string[];
  day?: string | null;
  at?: number | null;
  pending?: 'order' | 'booking' | null;
  cities?: string[];
}
const SKEY = (chat: number) => `tg:bz:${chat}`;
const MKEY = (chat: number) => `tg:bzmine:${chat}`;
const getS = async (chat: number) => (await kv.get<Session>(SKEY(chat))) ?? null;
const putS = (chat: number, s: Session) => kv.set(SKEY(chat), s, 86_400);

const faN = (n: number) => n.toLocaleString('fa-IR');
const toman = (rial: number) => `${faN(Math.round(rial / 10))} تومان`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const WD = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

async function send(chat: number, text: string, rows?: Btn[][], extra: Record<string, unknown> = {}) {
  await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(rows ? { reply_markup: { inline_keyboard: rows } } : {}), ...extra });
}
const home = (): Btn[] => [{ text: '🏠 صفحه کسب‌وکار', callback_data: 'bz:h' }];

/** the bot's @username, for the links the owner shares */
export async function botUsername(): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  const cached = await kv.get<string>('tg:botname');
  if (cached) return cached;
  try {
    const me = await tg('getMe', {});
    if (me?.username) await kv.set('tg:botname', me.username, 86_400);
    return me?.username ?? null;
  } catch {
    return null;
  }
}

function hoursToday(cat: PublicCatalog, now: number): string {
  const h = cat.hours.find((x) => x.weekday === tehranParts(now).weekday);
  return h && h.open ? `امروز ${h.from} تا ${h.to}` : 'امروز تعطیل';
}

async function card(chat: number, cat: PublicCatalog) {
  const now = Date.now();
  const lines = [`🏪 <b>${esc(cat.name)}</b>`, [cat.city, cat.address].filter(Boolean).map((x) => `📍 ${esc(x!)}`).join(' ') || '', `🕘 ${hoursToday(cat, now)}`, cat.phone ? `📞 ${esc(cat.phone)}` : '', cat.discount ? `🏷 ${esc(cat.discount.title)}: ${faN(cat.discount.pct)}٪ تخفیف` : ''].filter(Boolean);
  const rows: Btn[][] = [];
  const order = cat.products.length ? [{ text: '🛍 منو و سفارش', callback_data: 'bz:m' }] : [];
  const book = cat.services.length ? [{ text: '📅 رزرو نوبت', callback_data: 'bz:b' }] : [];
  if (cat.kind === 'service') rows.push(...[book, order].filter((r) => r.length));
  else rows.push(...[order, book].filter((r) => r.length));
  rows.push([{ text: '🌐 صفحه آنلاین', url: `${baseUrl()}/shop?b=${cat.slug}` }]);
  rows.push([{ text: '📋 سفارش‌ها و نوبت‌های من', callback_data: 'bz:my' }], [{ text: '🔍 کسب‌وکارهای دیگر', callback_data: 'bz:dir' }]);
  await send(chat, lines.join('\n'), rows);
}

/** /start b_<slug> */
export async function startBiz(chat: number, slug: string) {
  const cat = await getCatalog(slug);
  if (!cat) return send(chat, 'این کسب‌وکار پیدا نشد یا صفحه آنلاینش خاموش است.', [[{ text: '🔍 کسب‌وکارها', callback_data: 'bz:dir' }]]);
  await putS(chat, { slug, cart: {}, svc: [] });
  await card(chat, cat);
}

async function menu(chat: number, s: Session, cat: PublicCatalog, catIdx: number | null) {
  const cats = [...new Set(cat.products.map((p) => p.category?.trim() || 'سایر'))];
  if (catIdx === null && cats.length > 1) {
    const rows: Btn[][] = cats.map((c, i) => [{ text: c, callback_data: `bz:c:${i}` }]);
    rows.push([{ text: `🛒 سبد (${faN(count(s))})`, callback_data: 'bz:k' }], home());
    return send(chat, `منوی <b>${esc(cat.name)}</b> — دسته را انتخاب کنید:`, rows);
  }
  const want = catIdx === null ? null : cats[catIdx];
  const rows: Btn[][] = cat.products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => want === null || (p.category?.trim() || 'سایر') === want)
    .slice(0, 40)
    .map(({ p, i }) => [{ text: `${p.name} — ${toman(p.priceRial)}`, callback_data: `bz:a:${i}` }]);
  rows.push([{ text: `🛒 سبد (${faN(count(s))})`, callback_data: 'bz:k' }], cats.length > 1 ? [{ text: '🔙 دسته‌ها', callback_data: 'bz:m' }] : [], home());
  await send(chat, `${want ? `<b>${esc(want)}</b>\n` : ''}روی هر قلم بزنید تا به سبد اضافه شود:`, rows.filter((r) => r.length));
}
const count = (s: Session) => Object.values(s.cart).reduce((a, b) => a + b, 0);

async function cartView(chat: number, s: Session, cat: PublicCatalog) {
  const lines = Object.entries(s.cart).map(([id, q]) => ({ p: cat.products.find((x) => x.id === id), q })).filter((l) => l.p);
  if (!lines.length) return send(chat, 'سبد خالی است.', [[{ text: '🛍 منو', callback_data: 'bz:m' }], home()]);
  const sub = lines.reduce((a, l) => a + l.q * l.p!.priceRial, 0);
  const text = [`🛒 <b>سبد شما در ${esc(cat.name)}</b>`, ...lines.map((l) => `${esc(l.p!.name)} × ${faN(l.q)}: ${toman(l.q * l.p!.priceRial)}`), cat.discount ? `تخفیف ${faN(cat.discount.pct)}٪ و ارزش افزوده موقع ثبت حساب می‌شود.` : '', `جمع: <b>${toman(sub)}</b>`].filter(Boolean);
  await send(chat, text.join('\n'), [[{ text: '✅ ثبت سفارش', callback_data: 'bz:o' }, { text: '🗑 خالی کن', callback_data: 'bz:x' }], [{ text: '➕ ادامه خرید', callback_data: 'bz:m' }], home()]);
}

async function askContact(chat: number, what: string) {
  await send(chat, `برای ثبت ${what}، شماره موبایلتان را با دکمه پایین بفرستید (فقط به همین کسب‌وکار داده می‌شود).`, undefined, {
    reply_markup: { keyboard: [[{ text: '📱 ارسال شماره من', request_contact: true }], [{ text: 'انصراف' }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function services(chat: number, s: Session, cat: PublicCatalog, edit?: { message_id: number }) {
  const rows: Btn[][] = cat.services.slice(0, 30).map((x, i) => [{ text: `${s.svc.includes(x.id) ? '✅ ' : ''}${x.name} — ${faN(x.durationMin)} دقیقه، ${toman(x.priceRial)}`, callback_data: `bz:s:${i}` }]);
  if (s.svc.length) rows.push([{ text: '➡️ انتخاب روز', callback_data: 'bz:d' }]);
  rows.push(home());
  if (edit) await tg('editMessageReplyMarkup', { chat_id: chat, message_id: edit.message_id, reply_markup: { inline_keyboard: rows } }).catch(() => {});
  else await send(chat, 'خدمت‌ها را انتخاب کنید (چندتایی هم می‌شود):', rows);
}

const durationOf = (s: Session, cat: PublicCatalog) => s.svc.reduce((a, id) => a + (cat.services.find((x) => x.id === id)?.durationMin ?? 0), 0);

async function days(chat: number, s: Session, cat: PublicCatalog) {
  const now = Date.now();
  const cal = calendarOfCatalog(cat, await waitingTimes(cat.slug));
  const dur = durationOf(s, cat);
  const rows: Btn[][] = [];
  let day = tehranParts(now).date;
  for (let i = 0; i < 21 && rows.length < 10; i++) {
    if (availableSlots(cal, day, dur, now).length) rows.push([{ text: `📆 ${WD[weekdayOf(day)]} ${new Date(`${day}T12:00:00Z`).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' })}`, callback_data: `bz:D:${day}` }]);
    day = tehranParts(tehranMs(day, '12:00') + 86_400_000).date;
  }
  if (!rows.length) return send(chat, 'در سه هفته آینده زمان خالی نیست؛ با کسب‌وکار تماس بگیرید.', [home()]);
  rows.push([{ text: '🔙 تغییر خدمت', callback_data: 'bz:b' }], home());
  await send(chat, `مدت کل: ${faN(dur)} دقیقه. روز را انتخاب کنید:`, rows);
}

async function times(chat: number, s: Session, cat: PublicCatalog, day: string) {
  const now = Date.now();
  const slots = availableSlots(calendarOfCatalog(cat, await waitingTimes(cat.slug)), day, durationOf(s, cat), now).slice(0, 48);
  if (!slots.length) return send(chat, 'این روز پر شد؛ روز دیگری انتخاب کنید.', [[{ text: '🔙 روزها', callback_data: 'bz:d' }]]);
  const rows: Btn[][] = [];
  for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4).map((t) => ({ text: tehranParts(t).time, callback_data: `bz:T:${Math.round(t / 60_000)}` })));
  rows.push([{ text: '🔙 روز دیگر', callback_data: 'bz:d' }], home());
  await send(chat, `${WD[weekdayOf(day)]}: ساعت را انتخاب کنید`, rows);
}

async function mine(chat: number) {
  const list = (await kv.get<{ slug: string; id: string; biz: string }[]>(MKEY(chat))) ?? [];
  if (!list.length) return send(chat, 'هنوز سفارش یا نوبتی از این ربات ثبت نکرده‌اید.');
  const STATUS: Record<string, string> = { pending: '⏳ منتظر تأیید', confirmed: '✅ تأیید شد', preparing: '👨‍🍳 در حال آماده‌سازی', delivered: '📦 تحویل شد', done: '✂ انجام شد', canceled: '❌ لغو شد' };
  const rows = await Promise.all(list.slice(-10).reverse().map(async (m) => {
    const st = await refState(m.slug, m.id);
    return `${esc(m.biz)} — ${st?.kind === 'booking' ? 'نوبت' : 'سفارش'} <code>${m.id}</code>: ${st ? STATUS[st.status] ?? st.status : 'منقضی'}${st ? `\n   ${esc(st.summary)}` : ''}`;
  }));
  await send(chat, rows.join('\n'));
}

async function dirCities(chat: number, s: Session | null) {
  const all = await directory();
  if (!all.length) return send(chat, 'هنوز کسب‌وکاری صفحه آنلاینش را روشن نکرده.');
  const cities = [...new Set(all.map((c) => c.city || 'بدون شهر'))].slice(0, 30);
  await putS(chat, { ...(s ?? { slug: '', cart: {}, svc: [] }), cities });
  await send(chat, 'شهر را انتخاب کنید:', cities.map((c, i) => [{ text: c, callback_data: `bz:C:${i}` }]));
}

/** inline-button presses */
export async function bizCallback(q: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }) {
  const chat = q.message?.chat.id;
  const data = q.data ?? '';
  const answer = (text?: string) => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => {});
  if (!chat || !data.startsWith('bz:')) return answer();
  const [, op, arg] = data.split(':');
  let s = await getS(chat);
  if (op === 'dir') return Promise.all([answer(), dirCities(chat, s)]);
  if (op === 'C') {
    const city = s?.cities?.[+arg];
    const list = (await directory()).filter((c) => (c.city || 'بدون شهر') === city).slice(0, 40);
    await answer();
    return send(chat, `کسب‌وکارهای ${esc(city ?? '')}:`, list.map((c) => [{ text: c.name, callback_data: `bz:B:${c.slug}` }]));
  }
  if (op === 'B') return Promise.all([answer(), startBiz(chat, arg)]);
  if (op === 'my') return Promise.all([answer(), mine(chat)]);
  const cat = s ? await getCatalog(s.slug) : null;
  if (!s || !cat) {
    await answer();
    return send(chat, 'جلسه تمام شده؛ دوباره از لینک کسب‌وکار وارد شوید.', [[{ text: '🔍 کسب‌وکارها', callback_data: 'bz:dir' }]]);
  }
  switch (op) {
    case 'h':
      await answer();
      return card(chat, cat);
    case 'm':
      await answer();
      return menu(chat, s, cat, null);
    case 'c':
      await answer();
      return menu(chat, s, cat, +arg);
    case 'a': {
      const p = cat.products[+arg];
      if (!p) return answer('این قلم دیگر نیست.');
      s.cart[p.id] = Math.min(99, (s.cart[p.id] ?? 0) + 1);
      await putS(chat, s);
      return answer(`«${p.name}» به سبد رفت (${faN(count(s))} قلم)`);
    }
    case 'k':
      await answer();
      return cartView(chat, s, cat);
    case 'x':
      s.cart = {};
      await putS(chat, s);
      await answer('سبد خالی شد');
      return menu(chat, s, cat, null);
    case 'o':
      if (!count(s)) return answer('سبد خالی است');
      s.pending = 'order';
      await putS(chat, s);
      await answer();
      return askContact(chat, 'سفارش');
    case 'b':
      s.svc = [];
      await putS(chat, s);
      await answer();
      return services(chat, s, cat);
    case 's': {
      const x = cat.services[+arg];
      if (!x) return answer();
      s.svc = s.svc.includes(x.id) ? s.svc.filter((y) => y !== x.id) : [...s.svc, x.id];
      await putS(chat, s);
      await answer();
      return services(chat, s, cat, q.message);
    }
    case 'd':
      await answer();
      return s.svc.length ? days(chat, s, cat) : services(chat, s, cat);
    case 'D':
      s.day = arg;
      await putS(chat, s);
      await answer();
      return times(chat, s, cat, arg);
    case 'T':
      s.at = +arg * 60_000;
      s.pending = 'booking';
      await putS(chat, s);
      await answer();
      return askContact(chat, `نوبت ${whenFa(s.at)}`);
  }
  return answer();
}

/** the customer shared their number (or pressed «انصراف») */
export async function bizContact(msg: { chat: { id: number }; from?: { id: number; first_name?: string; last_name?: string }; contact?: { phone_number: string; user_id?: number; first_name?: string }; text?: string }): Promise<boolean> {
  const chat = msg.chat.id;
  const s = await getS(chat);
  if (!s?.pending) return false;
  const remove = { reply_markup: { remove_keyboard: true } };
  if (!msg.contact) {
    if (msg.text === 'انصراف') {
      await putS(chat, { ...s, pending: null });
      await send(chat, 'لغو شد.', undefined, remove);
      return true;
    }
    return false;
  }
  if (msg.contact.user_id && msg.from && msg.contact.user_id !== msg.from.id) {
    await send(chat, 'فقط شماره خودتان را با دکمه «ارسال شماره من» بفرستید.');
    return true;
  }
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.contact.first_name || 'مشتری تلگرام';
  const phone = msg.contact.phone_number;
  const cat = await getCatalog(s.slug);
  if (!cat) return true;
  const raw = s.pending === 'order' ? { name, phone, items: Object.entries(s.cart).map(([id, qty]) => ({ id, qty })) } : { name, phone, serviceIds: s.svc, startsAt: s.at };
  const r = await submit(s.slug, s.pending, raw, 'telegram', `tg:${chat}`, Date.now(), chat);
  if (!r.ok) {
    await send(chat, `⚠️ ${esc(r.error)}`, undefined, remove);
    if (s.pending === 'booking') await days(chat, s, cat);
    return true;
  }
  const list = ((await kv.get<{ slug: string; id: string; biz: string }[]>(MKEY(chat))) ?? []).slice(-19);
  await kv.set(MKEY(chat), [...list, { slug: s.slug, id: r.id, biz: cat.name }], 60 * 86_400);
  const what = s.pending === 'order' ? `سفارش شما (${toman(r.item.totalRial ?? 0)})` : `نوبت ${whenFa(r.item.startsAt!)}`;
  await putS(chat, { slug: s.slug, cart: {}, svc: [] });
  await send(chat, `✅ ${what} برای <b>${esc(cat.name)}</b> ثبت شد.\nکد پیگیری: <code>${r.id}</code>\nوقتی کسب‌وکار تأیید کند همین‌جا خبرتان می‌کنیم.`, undefined, remove);
  await send(chat, 'کار دیگری دارید؟', [home(), [{ text: '📋 سفارش‌ها و نوبت‌های من', callback_data: 'bz:my' }]]);
  return true;
}

const STATUS_MSG: Record<string, string> = {
  confirmed: 'تأیید شد ✅',
  preparing: 'در حال آماده‌سازی است 👨‍🍳',
  delivered: 'تحویل شد 📦',
  done: 'انجام شد ✂',
  canceled: 'لغو شد ❌',
};

/** the owner changed the status of something a Telegram customer sent */
export async function tellCustomer(chat: number, bizName: string, id: string, kind: 'order' | 'booking', status: string) {
  const m = STATUS_MSG[status];
  if (!m) return;
  await send(chat, `${esc(bizName)}: ${kind === 'booking' ? 'نوبت' : 'سفارش'} <code>${id}</code> ${m}`).catch(() => {});
}
