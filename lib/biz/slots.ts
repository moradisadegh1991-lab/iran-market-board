// Booking times — from Kasbai's lib/bookingSlots.ts, without the database: the same 15-minute grid,
// shift → opening-hours fallback and no-overlap rule, over plain data so the phone (bookings it
// takes by hand) and the server (bookings customers make on the public page or in Telegram) run the
// very same function.
//
// Iran has kept +03:30 all year since 1401 (daylight saving was abolished), so Tehran wall-clock
// time is a fixed offset from UTC.

import type { Hours, Shift } from './model';

export const TEHRAN_OFFSET_MIN = 210;
export const SLOT_STEP_MIN = 15;
const MIN = 60_000;

/** wall clock in Tehran for an instant */
export function tehranParts(ms: number): { date: string; time: string; weekday: number; minutes: number } {
  const t = new Date(ms + TEHRAN_OFFSET_MIN * MIN);
  const date = t.toISOString().slice(0, 10);
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return { date, time: hhmm(minutes), weekday: t.getUTCDay(), minutes };
}
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** the instant of a Tehran wall-clock time on a day */
export function tehranMs(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) + (minutesOf(time) - TEHRAN_OFFSET_MIN) * MIN;
}
export const weekdayOf = (date: string) => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay();
};

/** What deciding a time needs; both the full business and what it publishes have this shape. */
export interface Calendar {
  hours: Hours[];
  shifts: Shift[];
  /** active seats/chairs/tables; none = the business serves one customer at a time */
  seatIds: string[];
  /** taken times: every booking that is not canceled */
  busy: { startsAt: number; durationMin: number; seatId?: string | null; id?: string }[];
}

/** Working windows of a day: the seat's own shifts → the business's shifts → opening hours. */
export function windowsFor(cal: Pick<Calendar, 'hours' | 'shifts'>, date: string, seatId?: string | null): { from: string; to: string }[] {
  const wd = weekdayOf(date);
  const rows = cal.shifts.filter((s) => s.active && s.weekday === wd).sort((a, b) => a.from.localeCompare(b.from));
  if (seatId) {
    const own = rows.filter((s) => s.seatId === seatId);
    if (own.length) return own.map(({ from, to }) => ({ from, to }));
  }
  const general = rows.filter((s) => s.seatId === null);
  if (general.length) return general.map(({ from, to }) => ({ from, to }));
  const h = cal.hours.find((x) => x.weekday === wd);
  if (h && h.open && minutesOf(h.to) > minutesOf(h.from)) return [{ from: h.from, to: h.to }];
  return [];
}

const clash = (a: number, ad: number, b: number, bd: number) => a < b + bd * MIN && b < a + ad * MIN;

/**
 * Can a booking take [start, start+duration)? Without seats, any other booking at that time blocks
 * it. With seats, a booking on a seat blocks that seat; and no more bookings may overlap than there
 * are seats (a booking that has no seat yet still takes one).
 */
export function fits(cal: Calendar, startsAt: number, durationMin: number, seatId?: string | null, excludeId?: string | null): boolean {
  const over = cal.busy.filter((b) => (excludeId == null || b.id !== excludeId) && clash(startsAt, durationMin, b.startsAt, b.durationMin));
  if (!cal.seatIds.length) return over.length === 0;
  if (seatId && over.some((b) => b.seatId === seatId)) return false;
  return over.length < cal.seatIds.length;
}

/** the first seat free for that time, or null */
export function freeSeat(cal: Calendar, startsAt: number, durationMin: number, excludeId?: string | null): string | null {
  for (const id of cal.seatIds) if (fits(cal, startsAt, durationMin, id, excludeId)) return id;
  return null;
}

/** inside one of the day's working windows (for that seat, or any seat) */
export function withinHours(cal: Calendar, startsAt: number, durationMin: number, seatId?: string | null): boolean {
  const { date, minutes } = tehranParts(startsAt);
  const seats = seatId ? [seatId] : cal.seatIds.length ? cal.seatIds : [null];
  return seats.some((s) => windowsFor(cal, date, s).some((w) => minutes >= minutesOf(w.from) && minutes + durationMin <= minutesOf(w.to)));
}

/** Start times on a day, every 15 minutes, where the whole duration is free and inside working time. */
export function availableSlots(cal: Calendar, date: string, durationMin: number, now: number, seatId?: string | null): number[] {
  if (durationMin <= 0) return [];
  const seats = seatId ? [seatId] : cal.seatIds.length ? cal.seatIds : [null];
  const out = new Set<number>();
  for (const s of seats) {
    for (const w of windowsFor(cal, date, s)) {
      const end = tehranMs(date, w.to);
      for (let t = tehranMs(date, w.from); t + durationMin * MIN <= end; t += SLOT_STEP_MIN * MIN) {
        if (t >= now - MIN && fits(cal, t, durationMin, s)) out.add(t);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}
