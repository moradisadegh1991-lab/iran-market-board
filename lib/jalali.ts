/**
 * Jalali (هجری شمسی) ⇄ Gregorian conversion — no dependencies.
 * Uses the 33-year cycle breakdown of the Birashk/Khayyam algorithm, which matches
 * the official Iranian calendar for 1178–1633 Jalali (covers every date this app needs).
 * Verified against Intl's `fa-IR-u-ca-persian` in scripts/jalali-test.ts.
 */

export interface JDate {
  jy: number;
  jm: number;
  jd: number;
}

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456];

/** NOTE: this algorithm requires division and modulo that truncate toward zero
 *  (the reference implementation uses `~~`). Using Math.floor here silently shifts
 *  g2d by a year for January dates. */
function div(a: number, b: number) {
  return Math.trunc(a / b);
}

function mod(a: number, b: number) {
  return a - Math.trunc(a / b) * b;
}

/** Leap-year and March-equinox offset data for a Jalali year. */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error(`سال جلالی خارج از بازه پشتیبانی‌شده: ${jy}`);
  let jump = 0;
  for (let i = 1; i < bl; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(jump % 33, 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div((n % 33) + 3, 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4; // truncated modulo can go negative
  return { leap, gy, march };
}

/** Days in a Jalali month (1-12). */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalali(jy) ? 30 : 29;
}

export function isLeapJalali(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * ((gm + 9) % 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Jalali → Gregorian. Throws if the Jalali date does not exist (e.g. 30 Esfand in a common year). */
export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) throw new Error('تاریخ شمسی نامعتبر است.');
  if (jm < 1 || jm > 12) throw new Error('ماه شمسی باید بین ۱ و ۱۲ باشد.');
  if (jd < 1 || jd > jalaliMonthLength(jy, jm)) throw new Error(`روز ${jd} در این ماه شمسی وجود ندارد.`);
  const r = jalCal(jy);
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1);
}

/** Gregorian → Jalali. */
export function gregorianToJalali(gy: number, gm: number, gd: number): JDate {
  const jdn = g2d(gy, gm, gd);
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    // a Gregorian Jan/Feb date still belongs to the previous Jalali year;
    // the leap flag that matters is the one for that year's own calendar (r, computed above)
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' (Gregorian) → Jalali parts. */
export function isoToJalali(iso: string): JDate {
  const [y, m, d] = iso.split('-').map(Number);
  return gregorianToJalali(y, m, d);
}

/** Jalali parts → 'YYYY-MM-DD' (Gregorian), the format holdings are stored in. */
export function jalaliToIso(jy: number, jm: number, jd: number): string {
  const g = jalaliToGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** 'YYYY-MM-DD' (Gregorian) → '۲۰ شهریور ۱۴۰۵' for display. */
export function isoToJalaliLabel(iso: string): string {
  const { jy, jm, jd } = isoToJalali(iso);
  return `${fa(jd)} ${JALALI_MONTHS[jm - 1]} ${fa(jy)}`;
}

function fa(n: number): string {
  return new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);
}
