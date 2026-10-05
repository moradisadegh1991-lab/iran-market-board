// What a business publishes for its customers, and what customers send back — shared by the phone
// (which builds and applies these), the server (which checks and stores them) and the public page.
//
// Rule 80: the business's book stays on the phone. Only this catalog — names and prices of products
// and services, opening hours, which times are taken (no names), city and contact the owner chose
// to show — goes to the server, and only when the owner presses «انتشار». Orders and bookings that
// customers make wait on the server (with the name and phone the customer typed) until the owner's
// phone collects them, then are deleted there.

import type { Business, Hours, Shift } from './model';
import { typeInfo } from './model';
import { activeDiscounts } from './ops';
import { fits, tehranParts, withinHours, type Calendar } from './slots';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
export const PUBLISH_DAYS_AHEAD = 60;

export interface PublicProduct {
  id: string;
  name: string;
  priceRial: number;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
}
export interface PublicService {
  id: string;
  name: string;
  durationMin: number;
  priceRial: number;
  category?: string | null;
}
export interface PublicCatalog {
  v: 1;
  slug: string;
  name: string;
  type: string;
  kind: 'product' | 'service';
  phone?: string | null;
  address?: string | null;
  province?: string | null;
  city?: string | null;
  products: PublicProduct[];
  services: PublicService[];
  hours: Hours[];
  shifts: Shift[];
  seats: { id: string; name: string; capacity: number }[];
  /** taken times only: start, length and seat — never who */
  busy: { startsAt: number; durationMin: number; seatId?: string | null }[];
  discount?: { title: string; pct: number } | null;
  vatPct: number;
  publishedAt: number;
}

/** What the owner's phone sends; the server keeps it as is after `cleanCatalog`. */
export function catalogOf(b: Business, slug: string, now: number, today: string): PublicCatalog {
  const until = now + PUBLISH_DAYS_AHEAD * 86_400_000;
  const best = activeDiscounts(b, today).sort((a, c) => c.pct - a.pct)[0];
  return {
    v: 1,
    slug,
    name: b.name,
    type: b.type,
    kind: typeInfo(b.type).kind,
    phone: b.phone ?? null,
    address: b.address ?? null,
    province: b.province ?? null,
    city: b.city ?? null,
    products: b.products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, priceRial: p.priceRial, category: p.category ?? null, description: p.description ?? null, imageUrl: p.imageUrl ?? null })),
    services: b.services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceRial: s.priceRial, category: s.category ?? null })),
    hours: b.hours,
    shifts: b.shifts.filter((s) => s.active),
    seats: b.seats.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, capacity: s.capacity })),
    busy: b.bookings.filter((x) => x.status !== 'canceled' && x.startsAt + x.durationMin * 60_000 > now && x.startsAt < until).map((x) => ({ startsAt: x.startsAt, durationMin: x.durationMin, seatId: x.seatId ?? null })),
    discount: best ? { title: best.title, pct: best.pct } : null,
    vatPct: b.vatPct,
    publishedAt: now,
  };
}

// ── checking what comes in (the server must not trust the phone or the customer) ──

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const int = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : lo);
const hhmm = (x: unknown) => (typeof x === 'string' && /^\d{2}:\d{2}$/.test(x) ? x : '00:00');
const arr = (x: unknown, max: number): unknown[] => (Array.isArray(x) ? x.slice(0, max) : []);
const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
const MAX_RIAL = 1e13;

/** A catalog as the server stores it: bounded, typed, nothing extra. Throws on nonsense. */
export function cleanCatalog(raw: unknown, slug: string, now: number): PublicCatalog {
  const r = o(raw);
  const name = str(r.name, 80);
  if (!name) throw new Error('نام کسب‌وکار خالی است.');
  const httpsUrl = (x: unknown) => {
    const u = str(x, 400);
    return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
  };
  return {
    v: 1,
    slug,
    name,
    type: str(r.type, 20) || 'other',
    kind: r.kind === 'service' ? 'service' : 'product',
    phone: str(r.phone, 20) || null,
    address: str(r.address, 200) || null,
    province: str(r.province, 40) || null,
    city: str(r.city, 40) || null,
    products: arr(r.products, 400).map((x) => {
      const p = o(x);
      return { id: str(p.id, 40), name: str(p.name, 80), priceRial: int(p.priceRial, 0, MAX_RIAL), category: str(p.category, 40) || null, description: str(p.description, 300) || null, imageUrl: httpsUrl(p.imageUrl) };
    }).filter((p) => p.id && p.name),
    services: arr(r.services, 150).map((x) => {
      const s = o(x);
      return { id: str(s.id, 40), name: str(s.name, 80), durationMin: int(s.durationMin, 5, 24 * 60), priceRial: int(s.priceRial, 0, MAX_RIAL), category: str(s.category, 40) || null };
    }).filter((s) => s.id && s.name),
    hours: arr(r.hours, 7).map((x) => {
      const h = o(x);
      return { weekday: int(h.weekday, 0, 6), open: h.open === true, from: hhmm(h.from), to: hhmm(h.to) };
    }),
    shifts: arr(r.shifts, 200).map((x) => {
      const s = o(x);
      return { id: str(s.id, 40), seatId: str(s.seatId, 40) || null, weekday: int(s.weekday, 0, 6), from: hhmm(s.from), to: hhmm(s.to), active: true };
    }),
    seats: arr(r.seats, 60).map((x) => {
      const s = o(x);
      return { id: str(s.id, 40), name: str(s.name, 40), capacity: int(s.capacity, 1, 100) };
    }).filter((s) => s.id),
    busy: arr(r.busy, 3000).map((x) => {
      const b = o(x);
      return { startsAt: int(b.startsAt, 0, now + 400 * 86_400_000), durationMin: int(b.durationMin, 1, 24 * 60), seatId: str(b.seatId, 40) || null };
    }),
    discount: r.discount && str(o(r.discount).title, 60) ? { title: str(o(r.discount).title, 60), pct: int(o(r.discount).pct, 0, 100) } : null,
    vatPct: int(r.vatPct, 0, 100),
    publishedAt: now,
  };
}

/** An Iranian mobile number as 09xxxxxxxxx, from Persian or Latin digits, or null. */
export function mobile(x: unknown): string | null {
  const s = str(x, 30)
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/\D/g, '');
  const n = s.startsWith('98') ? '0' + s.slice(2) : s.startsWith('9') ? '0' + s : s;
  return /^09\d{9}$/.test(n) ? n : null;
}

/** A customer's order or booking, waiting on the server for the owner's phone. */
export interface InboxItem {
  id: string;
  kind: 'order' | 'booking';
  at: number;
  via: 'web' | 'telegram';
  name: string;
  phone: string;
  note?: string | null;
  /** order */
  lines?: { itemId: string; name: string; qty: number; unitRial: number }[];
  totalRial?: number;
  /** booking */
  serviceIds?: string[];
  startsAt?: number;
  durationMin?: number;
  seatId?: string | null;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Prices come from the published catalog, never from the customer. */
export function checkOrder(cat: PublicCatalog, raw: unknown): Checked<Pick<InboxItem, 'name' | 'phone' | 'note' | 'lines' | 'totalRial'>> {
  const r = o(raw);
  const name = str(r.name, 60);
  const phone = mobile(r.phone);
  if (!name) return { ok: false, error: 'نام خود را بنویسید.' };
  if (!phone) return { ok: false, error: 'شماره موبایل درست نیست (۰۹…).' };
  const lines: NonNullable<InboxItem['lines']> = [];
  for (const x of arr(r.items, 60)) {
    const it = o(x);
    const p = cat.products.find((q) => q.id === it.id);
    const qty = int(it.qty, 0, 99);
    if (!p || qty < 1) continue;
    lines.push({ itemId: p.id, name: p.name, qty, unitRial: p.priceRial });
  }
  if (!lines.length) return { ok: false, error: 'سبد خالی است.' };
  const sub = lines.reduce((s, l) => s + l.qty * l.unitRial, 0);
  const disc = Math.round((sub * (cat.discount?.pct ?? 0)) / 100);
  const total = sub - disc + Math.round(((sub - disc) * cat.vatPct) / 100);
  return { ok: true, value: { name, phone, note: str(r.note, 300) || null, lines, totalRial: total } };
}

/** A time is offered only if it is inside working hours and free — taken times include bookings still waiting on the server. */
export function checkBooking(cat: PublicCatalog, raw: unknown, waiting: { startsAt: number; durationMin: number; seatId?: string | null }[], now: number): Checked<Pick<InboxItem, 'name' | 'phone' | 'note' | 'serviceIds' | 'startsAt' | 'durationMin' | 'seatId'>> {
  const r = o(raw);
  const name = str(r.name, 60);
  const phone = mobile(r.phone);
  if (!name) return { ok: false, error: 'نام خود را بنویسید.' };
  if (!phone) return { ok: false, error: 'شماره موبایل درست نیست (۰۹…).' };
  const ids = [...new Set(arr(r.serviceIds, 10).map((x) => str(x, 40)))];
  const svcs = ids.map((id) => cat.services.find((s) => s.id === id)).filter((s): s is PublicService => !!s);
  if (!svcs.length) return { ok: false, error: 'خدمتی انتخاب نشده.' };
  const startsAt = int(r.startsAt, 0, now + PUBLISH_DAYS_AHEAD * 86_400_000);
  const durationMin = svcs.reduce((s, x) => s + x.durationMin, 0);
  if (startsAt < now) return { ok: false, error: 'این زمان گذشته است.' };
  const seatId = str(r.seatId, 40) || null;
  if (seatId && !cat.seats.some((s) => s.id === seatId)) return { ok: false, error: 'این مورد وجود ندارد.' };
  const cal = calendarOfCatalog(cat, waiting);
  if (!withinHours(cal, startsAt, durationMin, seatId)) return { ok: false, error: 'این زمان در ساعت کاری نیست.' };
  if (!fits(cal, startsAt, durationMin, seatId)) return { ok: false, error: 'این زمان همین الان پر شد؛ زمان دیگری انتخاب کنید.' };
  return { ok: true, value: { name, phone, note: str(r.note, 300) || null, serviceIds: svcs.map((s) => s.id), startsAt, durationMin, seatId } };
}

export function calendarOfCatalog(cat: PublicCatalog, waiting: { startsAt: number; durationMin: number; seatId?: string | null }[] = []): Calendar {
  return { hours: cat.hours, shifts: cat.shifts, seatIds: cat.seats.map((s) => s.id), busy: [...cat.busy, ...waiting] };
}

/** «۱۴:۳۰، دوشنبه» for messages */
export const whenFa = (ms: number) => {
  const p = tehranParts(ms);
  return `${new Date(ms).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' })} ساعت ${p.time.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])}`;
};
