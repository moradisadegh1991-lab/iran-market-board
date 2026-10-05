// The phone's half of «فروشگاه آنلاین» (rule 80): what customers sent becomes pending orders and
// bookings in the local book — the same as one typed in by hand, so confirming it takes stock and
// books the money as usual — and each one is applied exactly once whatever the network does.

import { newId, type FinanceData } from '@/lib/finance/model';
import type { Booking, Business } from './model';
import { addBooking, bizOf, createOrder } from './ops';
import type { InboxItem } from './public';

export function newToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** a slug suggestion from the name: Latin letters/digits only; Persian names fall back to biz-xxxx */
export function suggestSlug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s.length >= 3 ? s : `biz-${Math.random().toString(36).slice(2, 7)}`;
}

export interface Applied {
  orders: number;
  bookings: number;
  /** applied now or before: safe to delete on the server */
  ack: string[];
  /** could not become an order (a product deleted since publishing): kept as a note */
  problems: string[];
}

export function applyInbox(d: FinanceData, items: InboxItem[], now: number): Applied {
  const b = bizOf(d);
  if (!b.online) throw new Error('صفحه آنلاین روشن نیست.');
  const seen = new Set(b.online.seen);
  const res: Applied = { orders: 0, bookings: 0, ack: [], problems: [] };
  for (const it of items) {
    res.ack.push(it.id);
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    if (it.kind === 'order') {
      const o = createOrder(b, {
        items: (it.lines ?? []).filter((l) => b.products.some((p) => p.id === l.itemId)).map((l) => ({ itemId: l.itemId, qty: l.qty, unitRial: l.unitRial })),
        channel: it.via,
        customerName: it.name,
        customerPhone: it.phone,
        note: [it.note, `کد ${it.id}`].filter(Boolean).join('، '),
        at: it.at,
        ref: it.id,
      });
      if (typeof o === 'string') res.problems.push(`سفارش ${it.id} از ${it.name} (${it.phone}): ${(it.lines ?? []).map((l) => `${l.name}×${l.qty}`).join('، ')} — محصولش دیگر در منو نیست.`);
      else {
        // what the customer was shown is what they owe; a missing product is named in the note
        const missing = (it.lines ?? []).filter((l) => !b.products.some((p) => p.id === l.itemId));
        if (missing.length) o.note = [o.note, `حذف‌شده از منو: ${missing.map((l) => l.name).join('، ')}`].join('، ');
        res.orders++;
      }
    } else {
      const r = addBooking(b, { serviceIds: it.serviceIds ?? [], customerName: it.name, customerPhone: it.phone, startsAt: it.startsAt ?? now, seatId: it.seatId, source: it.via, note: it.note, status: 'pending', ref: it.id }, now);
      if (typeof r !== 'string') res.bookings++;
      else forceBooking(b, it, now, r);
    }
  }
  b.online.seen = [...seen].slice(-500);
  b.online.pulledAt = now;
  return res;
}

/** the time was taken on the phone after the last publish: keep the request, flagged, for the owner to sort out */
function forceBooking(b: Business, it: InboxItem, now: number, why: string) {
  const svcs = (it.serviceIds ?? []).map((id) => b.services.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const bk: Booking = {
    id: newId('r'),
    serviceIds: svcs.map((s) => s.id),
    serviceNames: svcs.map((s) => s.name),
    customerName: it.name,
    customerPhone: it.phone,
    startsAt: it.startsAt ?? now,
    durationMin: it.durationMin ?? svcs.reduce((a, s) => a + s.durationMin, 0),
    priceRial: svcs.reduce((a, s) => a + s.priceRial, 0),
    seatId: null,
    party: 1,
    status: 'pending',
    source: it.via,
    note: `⚠️ ${why} — با مشتری هماهنگ کنید، کد ${it.id}`,
    createdAt: now,
    ref: it.id,
  };
  b.bookings.push(bk);
}
