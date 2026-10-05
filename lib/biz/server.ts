// Server side of «فروشگاه آنلاین»: the published catalogs and the inbox of customer orders and
// bookings, in Redis (lib/store). Rule 80: nothing here is the owner's book. A catalog is what the
// owner chose to publish; an inbox item is what a customer sent, kept until the owner's phone
// collects it (acknowledged = deleted) and for 30 days at most. The owner proves ownership of a
// slug with a random token their phone made; only its hash is stored.

import { createHash, randomBytes } from 'node:crypto';
import { kv } from '@/lib/store';
import { checkBooking, checkOrder, cleanCatalog, SLUG_RE, type InboxItem, type PublicCatalog } from './public';

const DAY = 86_400;
const CATALOG_TTL = 180 * DAY;
const ITEM_TTL = 30 * DAY;
const REF_TTL = 60 * DAY;
const MAX_INBOX = 500;

const K = {
  owner: (s: string) => `biz:owner:${s}`,
  pub: (s: string) => `biz:pub:${s}`,
  inbox: (s: string) => `biz:inbox:${s}`,
  item: (s: string, id: string) => `biz:item:${s}:${id}`,
  ref: (s: string, id: string) => `biz:ref:${s}:${id}`,
  lock: (s: string) => `biz:lock:${s}`,
  index: 'biz:index',
};

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const okToken = (t: unknown): t is string => typeof t === 'string' && t.length >= 24 && t.length <= 128;

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 400) => ({ ok: false as const, error, status });

async function owns(slug: string, token: unknown): Promise<Result> {
  if (!SLUG_RE.test(slug)) return fail('نامک نامعتبر است.');
  if (!okToken(token)) return fail('کلید نامعتبر است.', 403);
  const h = await kv.get<string>(K.owner(slug));
  if (!h) return fail('این نامک منتشر نشده.', 404);
  return h === hashToken(token) ? { ok: true } : fail('این نامک مال کسب‌وکار دیگری است.', 403);
}

/** Publish or update. The first publish claims the slug for that token. */
export async function publish(slug: string, token: unknown, raw: unknown, now: number): Promise<Result<{ url: string }>> {
  if (!SLUG_RE.test(slug)) return fail('نامک فقط حروف کوچک لاتین، عدد و خط تیره، ۳ تا ۳۲ حرف.');
  if (!okToken(token)) return fail('کلید نامعتبر است.', 403);
  let cat: PublicCatalog;
  try {
    cat = cleanCatalog(raw, slug, now);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'کاتالوگ نامعتبر است.');
  }
  const h = hashToken(token);
  const claimed = await kv.setNx(K.owner(slug), h, CATALOG_TTL);
  if (!claimed) {
    const cur = await kv.get<string>(K.owner(slug));
    if (cur !== h) return fail('این نامک را کسب‌وکار دیگری برداشته؛ نامک دیگری انتخاب کنید.', 409);
    await kv.set(K.owner(slug), h, CATALOG_TTL);
  }
  await kv.set(K.pub(slug), cat, CATALOG_TTL);
  await kv.sadd(K.index, slug);
  return { ok: true, url: `/shop?b=${slug}` };
}

export async function unpublish(slug: string, token: unknown): Promise<Result> {
  const o = await owns(slug, token);
  if (!o.ok) return o;
  for (const id of await kv.lrange(K.inbox(slug))) await kv.del(K.item(slug, id));
  await Promise.all([kv.del(K.pub(slug)), kv.del(K.owner(slug)), kv.del(K.inbox(slug)), kv.srem(K.index, slug)]);
  return { ok: true };
}

export const getCatalog = (slug: string) => (SLUG_RE.test(slug) ? kv.get<PublicCatalog>(K.pub(slug)) : Promise.resolve(null));

async function inboxItems(slug: string): Promise<InboxItem[]> {
  const ids = await kv.lrange(K.inbox(slug));
  const items = await Promise.all(ids.map((id) => kv.get<InboxItem>(K.item(slug, id))));
  return items.filter((x): x is InboxItem => !!x);
}

/** Bookings customers made that the phone has not collected yet: their times are taken too. */
export async function waitingTimes(slug: string) {
  return (await inboxItems(slug)).filter((x) => x.kind === 'booking' && x.startsAt).map((x) => ({ startsAt: x.startsAt!, durationMin: x.durationMin!, seatId: x.seatId ?? null }));
}

/** a short tracking code the customer can read out: 8 letters/digits */
const newRef = () => randomBytes(5).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() + Date.now().toString(36).slice(-2).toUpperCase();

export interface RefState {
  kind: 'order' | 'booking';
  status: string;
  at: number;
  chat?: number | null;
  summary: string;
}

async function rateLimited(ip: string, slug: string): Promise<boolean> {
  const [a, b] = await Promise.all([kv.incr(`rl:biz:${ip}`, 600), kv.incr(`rl:bizslug:${slug}`, DAY)]);
  return a > 20 || b > 300;
}

/** A customer's order or booking (public page or Telegram). */
export async function submit(slug: string, kind: 'order' | 'booking', raw: unknown, via: 'web' | 'telegram', ip: string, now: number, chat?: number | null): Promise<Result<{ id: string; item: InboxItem }>> {
  const cat = await getCatalog(slug);
  if (!cat) return fail('این کسب‌وکار پیدا نشد.', 404);
  if (await rateLimited(ip, slug)) return fail('درخواست زیاد است؛ چند دقیقه بعد دوباره امتحان کنید.', 429);
  if ((await kv.lrange(K.inbox(slug))).length >= MAX_INBOX) return fail('صندوق سفارش این کسب‌وکار پر است؛ مستقیم تماس بگیرید.', 503);
  const id = newRef();
  let item: InboxItem;
  if (kind === 'order') {
    const c = checkOrder(cat, raw);
    if (!c.ok) return fail(c.error);
    item = { id, kind, at: now, via, ...c.value };
  } else {
    // one booking at a time per business, so two customers cannot take the same time
    let locked = false;
    for (let i = 0; i < 10 && !(locked = await kv.setNx(K.lock(slug), 1, 5)); i++) await new Promise((r) => setTimeout(r, 300));
    if (!locked) return fail('شلوغ است؛ دوباره امتحان کنید.', 503);
    try {
      const c = checkBooking(cat, raw, await waitingTimes(slug), now);
      if (!c.ok) return fail(c.error, 409);
      item = { id, kind, at: now, via, ...c.value };
      await kv.set(K.item(slug, id), item, ITEM_TTL);
      await kv.rpush(K.inbox(slug), id);
    } finally {
      await kv.del(K.lock(slug));
    }
  }
  if (kind === 'order') {
    await kv.set(K.item(slug, id), item, ITEM_TTL);
    await kv.rpush(K.inbox(slug), id);
  }
  const summary = kind === 'order' ? item.lines!.map((l) => `${l.name}×${l.qty}`).join('، ') : cat.services.filter((s) => item.serviceIds!.includes(s.id)).map((s) => s.name).join(' + ');
  await kv.set(K.ref(slug, id), { kind, status: 'pending', at: now, chat: chat ?? null, summary } satisfies RefState, REF_TTL);
  return { ok: true, id, item };
}

/** The owner's phone collects its inbox; `ack` deletes what it already applied. */
export async function pull(slug: string, token: unknown, ack: unknown): Promise<Result<{ items: InboxItem[] }>> {
  const o = await owns(slug, token);
  if (!o.ok) return o;
  for (const id of Array.isArray(ack) ? ack.slice(0, MAX_INBOX) : []) {
    if (typeof id !== 'string') continue;
    await kv.lrem(K.inbox(slug), id);
    await kv.del(K.item(slug, id));
  }
  return { ok: true, items: await inboxItems(slug) };
}

export const refState = (slug: string, id: string) => (SLUG_RE.test(slug) && /^[A-Z0-9]{4,12}$/.test(id) ? kv.get<RefState>(K.ref(slug, id)) : Promise.resolve(null));

/** The owner confirmed, finished or canceled something a customer sent: its status for the customer. */
export async function setRefStatus(slug: string, token: unknown, id: string, status: string): Promise<Result<{ chat: number | null; state: RefState | null }>> {
  const o = await owns(slug, token);
  if (!o.ok) return o;
  const st = await refState(slug, id);
  if (!st) return { ok: true, chat: null, state: null };
  const next = { ...st, status: String(status).slice(0, 20) };
  await kv.set(K.ref(slug, id), next, REF_TTL);
  return { ok: true, chat: st.chat ?? null, state: next };
}

/** Published businesses (the Telegram directory). */
export async function directory(): Promise<PublicCatalog[]> {
  const slugs = await kv.smembers(K.index);
  const cats = await Promise.all(slugs.slice(0, 300).map((s) => kv.get<PublicCatalog>(K.pub(s))));
  const gone = slugs.filter((_, i) => !cats[i]);
  for (const s of gone) await kv.srem(K.index, s);
  return cats.filter((c): c is PublicCatalog => !!c);
}
