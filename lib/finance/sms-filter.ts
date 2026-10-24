// «فیلتر زمانی» of the bank-SMS page: which part of the phone inbox to read, and which queued rows to
// show. Pure; dates are Tehran calendar days (Iso), months are Jalali.
import { isoToJalali, jalaliToIso } from '@/lib/jalali';
import { addDays } from './calc';
import type { Iso } from './model';

export type RangeKind = 'all' | 'today' | 'd7' | 'd30' | 'd90' | 'month' | 'custom';
export interface TimeRange {
  kind: RangeKind;
  /** custom only */
  from?: Iso | null;
  to?: Iso | null;
}

export const RANGE_LABEL: Record<RangeKind, string> = {
  all: 'همه',
  today: 'امروز',
  d7: '۷ روز اخیر',
  d30: '۳۰ روز اخیر',
  d90: '۹۰ روز اخیر',
  month: 'این ماه',
  custom: 'بازه دلخواه',
};

/** First and last day of a range (inclusive); null = open. */
export function rangeBounds(r: TimeRange, today: Iso): { from: Iso | null; to: Iso | null } {
  switch (r.kind) {
    case 'all':
      return { from: null, to: null };
    case 'today':
      return { from: today, to: today };
    case 'd7':
      return { from: addDays(today, -6), to: today };
    case 'd30':
      return { from: addDays(today, -29), to: today };
    case 'd90':
      return { from: addDays(today, -89), to: today };
    case 'month': {
      const j = isoToJalali(today);
      return { from: jalaliToIso(j.jy, j.jm, 1), to: today };
    }
    case 'custom': {
      const from = r.from || null, to = r.to || null;
      // a range typed backwards is read the way it was meant
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
  }
}

/** A row's day inside the range. Undated rows show only under «همه». */
export function inRange(date: Iso | null | undefined, b: { from: Iso | null; to: Iso | null }): boolean {
  if (!b.from && !b.to) return true;
  if (!date) return false;
  return (!b.from || date >= b.from) && (!b.to || date <= b.to);
}

const TEHRAN = '+03:30'; // no DST since 2022
const dayStartMs = (iso: Iso) => Date.parse(`${iso}T00:00:00${TEHRAN}`);

/**
 * What to ask the phone for. `all` = since the last read (the first time, the last `firstDays` days);
 * any other range = exactly its days, from 00:00 of its first day to the end of its last, Tehran time.
 */
export function readWindow(r: TimeRange, today: Iso, lastRead: number | null, firstDays: number, now: number): { sinceMs: number; untilMs: number | null } {
  if (r.kind === 'all') return { sinceMs: lastRead ?? now - firstDays * 86_400_000, untilMs: null };
  const b = rangeBounds(r, today);
  const sinceMs = b.from ? dayStartMs(b.from) : now - firstDays * 86_400_000;
  const untilMs = b.to && b.to < today ? dayStartMs(addDays(b.to, 1)) - 1 : null;
  return { sinceMs, untilMs };
}
