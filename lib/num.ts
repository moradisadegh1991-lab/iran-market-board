// Parsing & formatting helpers (Persian digits, rial → toman, Tehran time)

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/[,\s٬]/g, '')
    .replace('٫', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** unify Arabic/Persian letter variants so TSETMC, BrsApi and backfill keys match */
export function normSymbol(v: unknown): string {
  return String(v ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function pick(obj: any, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const nfInt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });

export function fmtInt(n: number | null | undefined): string {
  return isNum(n) ? nfInt.format(Math.round(n)) : '—';
}

/** smart precision: big numbers → int, small crypto prices → up to 6 decimals */
export function fmtPrice(n: number | null | undefined): string {
  if (!isNum(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return nfInt.format(Math.round(n));
  if (a >= 1) return nf2.format(n);
  const digits = a >= 0.01 ? 4 : a >= 0.0001 ? 6 : 8;
  return new Intl.NumberFormat('fa-IR', { maximumSignificantDigits: 4, maximumFractionDigits: digits }).format(n);
}

/** percent given as percent units (2.3 → ‎+۲٫۳٪) */
export function fmtPct(p: number | null | undefined, digits = 1, signed = true): string {
  if (!isNum(p)) return '—';
  return new Intl.NumberFormat('fa-IR', {
    style: 'percent',
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(p / 100);
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  return isNum(n) ? new Intl.NumberFormat('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n) : '—';
}

export function fmtCompactUsd(n: number | null | undefined): string {
  if (!isNum(n)) return '—';
  if (n >= 1e9) return `${nf2.format(n / 1e9)} میلیارد $`;
  if (n >= 1e6) return `${nf2.format(n / 1e6)} میلیون $`;
  return `${nfInt.format(n)} $`;
}

export const rialToToman = (r: number | null | undefined) => (isNum(r) ? r / 10 : NaN);

/** YYYY-MM-DD in Asia/Tehran */
export function tehranDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function tehranClock(d: Date = new Date()): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: map[wd] ?? 0, minutes: h * 60 + m };
}

/** TSE trading day: Saturday..Wednesday */
export function isTseTradingDay(d: Date = new Date()): boolean {
  const { weekday } = tehranClock(d);
  return weekday === 6 || weekday <= 3;
}

/** TSE session roughly 09:00–12:30 Tehran (+ buffer) */
export function isTseSessionOpen(d: Date = new Date()): boolean {
  const { minutes } = tehranClock(d);
  return isTseTradingDay(d) && minutes >= 8 * 60 + 45 && minutes <= 12 * 60 + 45;
}

export function fmtDateTimeFa(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function msToTehranDate(ms: number): string {
  return tehranDate(new Date(ms));
}
