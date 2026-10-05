// کسب‌وکار من by voice (rule 81): «دو تا لاته و یه کیک فروختم، نقد» → a sale; «برای سارا فردا ساعت پنج
// عصر اصلاح مو نوبت بذار» → a booking; «نوبت سارا انجام شد، کارت» / «نوبت ساعت پنج رو لغو کن».
//
// The same rules as the transaction dialog (lib/finance/voice.ts, rule 68): understood on the device,
// asks for what is missing with buttons for the choices, reads the whole thing back — the total in
// words — and changes the book only on «بله». Products and services are found by the names the owner
// gave them; nothing is guessed: an ambiguous word («کیک» when there are two cakes) is asked about,
// and the payment method is always said or asked, never assumed (rule 3).

import type { FinanceData, Iso } from '@/lib/finance/model';
import { addDays } from '@/lib/finance/calc';
import { clean, numberValue, numToWords, amountWords } from '@/lib/finance/voice';
import { JALALI_MONTHS, jalaliToIso, isoToJalali } from '@/lib/jalali';
import { PAY_LABEL, type Booking, type Business, type PayMethod } from './model';
import { activeDiscounts, addBooking, calendarOf, cancelOrder, orderTotals, quickSale, setBookingStatus } from './ops';
import { availableSlots, fits, hhmm, minutesOf, tehranMs, tehranParts, weekdayOf, withinHours } from './slots';

export interface Option {
  key: string;
  label: string;
}

// ── words ──────────────────────────────────────────────────────────────────

const isNum = (w: string) => !!numberValue([w]);
const UNIT_WORDS = new Set(['تا', 'عدد', 'دونه', 'دانه', 'پرس', 'لیوان', 'فنجان', 'بسته', 'کیلو', 'تایی', 'عددی', 'نفر', 'جلسه', 'بار']);
const STOP = new Set([
  'و', 'با', 'برای', 'به', 'از', 'هم', 'رو', 'را', 'یه', 'یک', 'تا', 'عدد', 'فروختم', 'فروختیم', 'فروش', 'بفروش', 'فروشی', 'ثبت', 'کن', 'کردم', 'بزن', 'نقد', 'نقدی',
  'کارت', 'کارتی', 'نسیه', 'حساب', 'مشتری', 'آقا', 'خانم', 'اسم', 'نام', 'شماره', 'سفارش', 'فاکتور', 'نوبت', 'بذار', 'بزار', 'بده', 'امروز', 'فردا', 'ساعت', 'صبح', 'ظهر',
  'عصر', 'شب', 'دادم', 'داد', 'دادن', 'خرید', 'خرید', 'هست', 'است', 'بود', 'شد', 'انجام', 'تموم', 'تمام', 'لغو', 'کنسل', 'اینو', 'اون', 'این', 'دیگه', 'هم',
]);

/** «۰۹۱۲ ۳۴۵ ۶۷۸۹» said or typed in pieces → 09123456789 */
export function phoneIn(text: string): string | null {
  const digits = clean(text)
    .split(' ')
    .filter((w) => /^\d+$/.test(w))
    .join('');
  const m = digits.match(/(?:98|0)?9\d{9}/);
  if (!m) return null;
  const s = m[0];
  return s.startsWith('98') ? '0' + s.slice(2) : s.startsWith('0') ? s : '0' + s;
}

export function payIn(text: string): PayMethod | null {
  const c = ` ${clean(text)} `;
  if (/ (نسیه|نسیه‌ای|دفتری|قرضی|بعدا میده|بعدا میدن|حساب میکنه) /.test(c)) return 'credit';
  if (/ (کارت|کارتی|کارتخوان|کارت خوان|پوز|کارت کشید|کشید) /.test(c)) return 'card';
  if (/ (نقد|نقدی|نقداً|نقدا|پول نقد|کش|اسکناس) /.test(c)) return 'cash';
  return null;
}

/** «برای سارا» / «به اسم حسن آقا» → the name (up to three words, stopping at the next known word) */
export function nameIn(text: string, known: Set<string> = new Set()): string | null {
  const toks = clean(text).split(' ');
  for (let i = 0; i < toks.length; i++) {
    const after = toks[i] === 'برای' ? i + 1 : (toks[i] === 'اسم' || toks[i] === 'نام') && i > 0 && toks[i - 1] === 'به' ? i + 1 : -1;
    if (after < 0) continue;
    const name: string[] = [];
    for (let j = after; j < toks.length && name.length < 3; j++) {
      const w = toks[j];
      if (STOP.has(w) && !(name.length && (w === 'آقا' || w === 'خانم')) || isNum(w) || /^\d/.test(w) || known.has(w)) break;
      name.push(w);
    }
    if (name.length) return name.join(' ');
  }
  return null;
}

// ── the day and the time (bookings) ─────────────────────────────────────────

const WEEKDAY_WORDS: [string, number][] = [
  ['یک شنبه', 0], ['یکشنبه', 0], ['دو شنبه', 1], ['دوشنبه', 1], ['سه شنبه', 2], ['سهشنبه', 2], ['چهار شنبه', 3], ['چهارشنبه', 3],
  ['پنج شنبه', 4], ['پنجشنبه', 4], ['جمعه', 5], ['شنبه', 6],
];

/** A day from now on: امروز، فردا، پس‌فردا، a weekday (its next occurrence, today included), «۲۰ مهر». */
export function dayIn(text: string, today: Iso): Iso | null {
  const c = ` ${clean(text)} `;
  if (/ پس ?فردا /.test(c)) return addDays(today, 2);
  if (/ فردا /.test(c)) return addDays(today, 1);
  if (/ (امروز|امشب) /.test(c)) return today;
  for (const [w, wd] of WEEKDAY_WORDS) {
    if (!c.includes(` ${w} `)) continue;
    const ahead = (wd - weekdayOf(today) + 7) % 7;
    return addDays(today, / (هفته بعد|هفته دیگه|هفته آینده) /.test(c) && ahead < 7 ? ahead + 7 : ahead);
  }
  const toks = c.trim().split(' ');
  for (let i = 1; i < toks.length; i++) {
    const m = JALALI_MONTHS.indexOf(toks[i]);
    if (m < 0) continue;
    const n = numberValue([toks[i - 1]]);
    if (!n || n.value < 1 || n.value > 31) continue;
    const j = isoToJalali(today);
    let iso = jalaliToIso(j.jy, m + 1, n.value);
    if (iso < today) iso = jalaliToIso(j.jy + 1, m + 1, n.value);
    return iso;
  }
  return null;
}

/**
 * «ساعت پنج و نیم عصر» → 17:30, «ساعت ۱۰ صبح», «۱۷:۳۰», «ساعت دو و ربع». Without صبح/عصر an hour from 1 to 7 is
 * afternoon — shops are not open at 3 at night — and the readback says which it took, so a wrong guess is heard.
 */
export function timeIn(text: string): string | null {
  const toks = clean(text).split(' ');
  for (let i = 0; i < toks.length; i++) {
    const at = toks[i] === 'ساعت' ? i + 1 : isNum(toks[i]) && /^(صبح|ظهر|عصر|شب|بعدازظهر)$/.test(toks[i + 1] ?? '') ? i : -1;
    if (at < 0 || at >= toks.length) continue;
    const h0 = numberValue([toks[at]]);
    if (!h0 || h0.value > 24 || !Number.isInteger(h0.value)) continue;
    let h = h0.value;
    let m = 0;
    let k = at + 1;
    if (toks[k] === 'و') {
      if (toks[k + 1] === 'نیم') ((m = 30), (k += 2));
      else if (toks[k + 1] === 'ربع') ((m = 15), (k += 2));
      else if (toks[k + 1] === 'سه' && toks[k + 2] === 'ربع') ((m = 45), (k += 3));
      else {
        const run: string[] = [];
        let j = k + 1;
        while (j < toks.length && (isNum(toks[j]) || (toks[j] === 'و' && isNum(toks[j + 1] ?? '')))) run.push(toks[j++]);
        const v = numberValue(run);
        if (v && v.value < 60) ((m = v.value), (k = j));
        if (toks[k] === 'دقیقه') k++;
      }
    } else if (/^\d+$/.test(toks[k] ?? '') && +toks[k] < 60 && /^\d+$/.test(toks[at])) ((m = +toks[k]), k++);
    const rest = toks.slice(k, k + 3).join(' ');
    if (/^(صبح)/.test(rest)) h = h === 12 ? 0 : h;
    else if (/^(ظهر)/.test(rest)) h = h < 11 ? h + 12 : h;
    else if (/^(عصر|شب|بعد از ظهر|بعدازظهر|غروب)/.test(rest)) h = h < 12 ? h + 12 : h;
    else if (h >= 1 && h <= 7) h += 12;
    if (h === 24) h = 0;
    return hhmm(h * 60 + m);
  }
  return null;
}

/** 17:30 → «پنج و نیم عصر» */
export function timeWords(t: string): string {
  const mins = minutesOf(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const part = h < 12 ? 'صبح' : h < 14 ? 'ظهر' : h < 19 ? 'عصر' : 'شب';
  return `${numToWords(h12)}${m === 30 ? ' و نیم' : m === 15 ? ' و ربع' : m ? ` و ${numToWords(m)} دقیقه` : ''} ${part}`;
}
const faT = (t: string) => t.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);

/** The free start just before and just after a wanted time (what a person offers: «۹:۳۰ یا ۱۲»). */
export function nearestFree(free: number[], at: number): { before: number | null; after: number | null } {
  let before: number | null = null;
  let after: number | null = null;
  for (const t of free) {
    if (t < at) before = t;
    else if (t > at && after == null) after = t;
  }
  return { before, after };
}

/** «امروز», «فردا», «پنجشنبه ۱۷ مهر» */
export function dayWords(iso: Iso, today: Iso): string {
  if (iso === today) return 'امروز';
  if (iso === addDays(today, 1)) return 'فردا';
  if (iso === addDays(today, 2)) return 'پس‌فردا';
  const j = isoToJalali(iso);
  const WD = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  return `${WD[weekdayOf(iso)]} ${j.jd.toLocaleString('fa-IR')} ${JALALI_MONTHS[j.jm - 1]}`;
}

// ── finding products and services by the names the owner gave them ─────────

interface Item {
  id: string;
  kind: 'product' | 'service';
  name: string;
  words: string[];
  priceRial: number;
}
const itemsOf = (b: Business, only?: 'product' | 'service'): Item[] => [
  ...(only === 'service' ? [] : b.products.filter((p) => p.active).map((p) => ({ id: p.id, kind: 'product' as const, name: p.name, words: clean(p.name).split(' '), priceRial: p.priceRial }))),
  ...(only === 'product' ? [] : b.services.filter((s) => s.active).map((s) => ({ id: s.id, kind: 'service' as const, name: s.name, words: clean(s.name).split(' '), priceRial: s.priceRial }))),
];

export interface Found {
  item: Item | null;
  /** an ambiguous word: these all contain it */
  candidates: Item[];
  word: string;
  qty: number;
}

/** the count said right before (or after) the name: «دو تا لاته», «بیست و پنج عدد», «لاته دو تا»; 1 when none */
function qtyAround(toks: string[], from: number, to: number, used: boolean[]): number {
  let i = from - 1;
  while (i >= 0 && UNIT_WORDS.has(toks[i])) i--;
  const run: string[] = [];
  while (i >= 0 && !used[i] && (isNum(toks[i]) || (toks[i] === 'و' && i > 0 && isNum(toks[i - 1]) && run.length && isNum(run[0])))) {
    run.unshift(toks[i]);
    used[i] = true;
    i--;
  }
  const before = numberValue(run.filter((w) => w !== 'و' || true));
  if (before && before.value >= 1 && before.value < 1000) return Math.round(before.value);
  // after: «لاته دو تا»
  const run2: string[] = [];
  let j = to;
  while (j < toks.length && (isNum(toks[j]) || (toks[j] === 'و' && isNum(toks[j + 1] ?? '') && run2.length))) run2.push(toks[j++]);
  if (run2.length && UNIT_WORDS.has(toks[j] ?? '')) {
    const v = numberValue(run2);
    if (v && v.value >= 1 && v.value < 1000) {
      for (let k = to; k <= j; k++) used[k] = true;
      return Math.round(v.value);
    }
  }
  return 1;
}

/** Every product/service named in the sentence, longest names first; a word shared by several is ambiguous. */
export function itemsIn(b: Business, text: string, only?: 'product' | 'service'): Found[] {
  const toks = clean(text).split(' ').filter(Boolean);
  const used = toks.map(() => false);
  const items = itemsOf(b, only).sort((a, c) => c.words.length - a.words.length || c.name.length - a.name.length);
  const out: (Found & { at: number })[] = [];
  // whole names
  for (const it of items) {
    for (let i = 0; i + it.words.length <= toks.length; i++) {
      if (it.words.every((w, k) => toks[i + k] === w && !used[i + k])) {
        for (let k = 0; k < it.words.length; k++) used[i + k] = true;
        out.push({ item: it, candidates: [it], word: it.name, qty: qtyAround(toks, i, i + it.words.length, used), at: i });
      }
    }
  }
  // one distinctive word of a name: «کیک» for «کیک شکلاتی»
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (used[i] || w.length < 2 || STOP.has(w) || isNum(w) || UNIT_WORDS.has(w)) continue;
    const c = items.filter((it) => it.words.includes(w));
    if (!c.length) continue;
    used[i] = true;
    out.push({ item: c.length === 1 ? c[0] : null, candidates: c, word: w, qty: qtyAround(toks, i, i + 1, used), at: i });
  }
  return out.sort((a, c) => a.at - c.at).map(({ at: _, ...f }) => f);
}

// ── the dialog ─────────────────────────────────────────────────────────────

export interface SaleLine {
  itemId: string;
  kind: 'product' | 'service';
  name: string;
  qty: number;
  unitRial: number;
}
export interface SaleDraft {
  kind: 'sale';
  lines: SaleLine[];
  pay: PayMethod | null;
  customerName: string | null;
  customerPhone: string | null;
  creditId: string | null;
  discountId: string | null;
  /** an ambiguous word waiting for «کدوم؟» */
  pending: { word: string; qty: number; ids: string[] } | null;
}
export interface BookDraft {
  kind: 'book';
  serviceIds: string[];
  day: Iso | null;
  time: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** «شماره نداره» */
  noPhone: boolean;
}
export interface FinishDraft {
  kind: 'done' | 'cancel';
  bookingId: string | null;
  pay: PayMethod | null;
}
export type BizDraft = SaleDraft | BookDraft | FinishDraft;
export type BizAsk = 'items' | 'pick' | 'pay' | 'credit' | 'service' | 'day' | 'time' | 'name' | 'phone' | 'which' | 'confirm' | 'fix';

export interface BizVoiceState {
  draft: BizDraft;
  asking: BizAsk;
  options: Option[];
  say: string;
  done: null | 'save' | 'cancel';
  misses: number;
}

const RX_CANCEL = /(^| )(بیخیال|بی خیال|ولش کن|نمیخوام|نمی خوام|ثبت نکن|منصرف|کنسلش کن)( |$)/;
const RX_YES = /^(بله|بلی|آره|اره|آری|باشه|اوکی|ok|okay|yes|حتما|درسته|درست|ثبت کن|ثبتش کن|بزن|همینه|خوبه|تایید|تأیید)( .*)?$/;
const RX_NO = /^(نه|نخیر|خیر|نچ|no|غلطه|اشتباهه|درست نیست)( |$)/;
const RX_SALE = /(^| )(فروختم|فروختیم|فروخت|بفروش|فروش|فاکتور کن|فاکتور بزن|حساب کن|ثبت فروش|سفارش|بردن|برد|خریدن|خرید کرد)( |$)/;
const RX_BOOK = /(^| )نوبت|(^| )رزرو/;
const RX_BOOK_SET = /(بذار|بزار|بزن|ثبت کن|بگیر|بده|رزرو کن|میخواد|می خواد|میخوان|اضافه کن)( |$)/;
const RX_DONE = /(انجام شد|انجام دادم|تموم شد|تمام شد|تموم کردم|کارش تموم|اومد و رفت|کارش انجام)/;
const RX_CANCELB = /(لغو|کنسل|نمیاد|نمی اد|نمی‌آد|کنسلش|حذفش)/;
const RX_NOPHONE = /(نداره|ندارم|نداریم|بی شماره|بدون شماره|شماره نمیخواد|بعدا|ولش)/;

const total = (b: Business, d: SaleDraft) => orderTotals(d.lines.map((l) => ({ qty: l.qty, unitRial: l.unitRial })), b.discounts.find((x) => x.id === d.discountId)?.pct ?? 0, b.vatPct);
const linesWords = (lines: SaleLine[]) => lines.map((l) => `${l.qty === 1 ? 'یک' : numToWords(l.qty)} ${l.qty > 1 && l.kind === 'product' ? 'تا ' : ''}${l.name}`).join(' و ');
const durOf = (b: Business, ids: string[]) => ids.reduce((s, id) => s + (b.services.find((x) => x.id === id)?.durationMin ?? 0), 0);

function addLines(b: Business, d: SaleDraft, found: Found[]): SaleDraft {
  const lines = [...d.lines];
  let pending = d.pending;
  for (const f of found) {
    if (!f.item) {
      pending = { word: f.word, qty: f.qty, ids: f.candidates.map((c) => c.id) };
      continue;
    }
    const ex = lines.find((l) => l.itemId === f.item!.id);
    if (ex) ex.qty += f.qty;
    else lines.push({ itemId: f.item.id, kind: f.item.kind, name: f.item.name, qty: f.qty, unitRial: f.item.priceRial });
  }
  return { ...d, lines, pending };
}

/** What a sentence adds to a sale: items, how it was paid, who bought it. */
function absorbSale(b: Business, d: SaleDraft, text: string, today: Iso): { draft: SaleDraft; used: boolean } {
  let n = { ...d, lines: d.lines.map((l) => ({ ...l })) };
  let used = false;
  const c = ` ${clean(text)} `;
  // «لاته رو حذف کن» / «بدون کیک»
  if (/ (حذف|بردار|نمیخواد|نمی خواد|نباشه|کم کن) /.test(c) || / بدون /.test(c)) {
    const rm = itemsIn(b, text);
    if (rm.length) {
      const ids = new Set(rm.flatMap((f) => (f.item ? [f.item.id] : f.candidates.map((x) => x.id))));
      n.lines = n.lines.filter((l) => !ids.has(l.itemId));
      return { draft: n, used: true };
    }
  }
  const found = itemsIn(b, text);
  if (found.length) ((n = addLines(b, n, found)), (used = true));
  const pay = payIn(text);
  if (pay) ((n.pay = pay), (used = true));
  const known = new Set(itemsOf(b).flatMap((i) => i.words));
  const name = nameIn(text, known);
  if (name) {
    n.customerName = name;
    const cr = b.credit.find((x) => clean(x.name) === clean(name) || clean(x.name).includes(clean(name)));
    if (cr) n.creditId = cr.id;
    used = true;
  }
  const phone = phoneIn(text);
  if (phone) ((n.customerPhone = phone), (used = true));
  if (/ (با تخفیف|تخفیف بده|تخفیف بزن) /.test(c)) {
    const ds = activeDiscounts(b, today);
    const pick = ds.find((x) => c.includes(` ${clean(x.title)} `)) ?? (ds.length === 1 ? ds[0] : null);
    if (pick) ((n.discountId = pick.id), (used = true));
  }
  return { draft: n, used };
}

function nextSale(b: Business, d: SaleDraft): Omit<BizVoiceState, 'draft' | 'done' | 'misses'> & { draft: SaleDraft } {
  if (d.pending) {
    const opts = d.pending.ids.map((id) => itemsOf(b).find((x) => x.id === id)).filter(Boolean) as Item[];
    return { draft: d, asking: 'pick', options: opts.map((o) => ({ key: o.id, label: o.name })), say: `کدوم «${d.pending.word}»؟ ${opts.map((o) => o.name).join('، ')}؟` };
  }
  if (!d.lines.length) return { draft: d, asking: 'items', options: [], say: 'چی فروختی؟ مثلاً: دو تا لاته و یه کیک.' };
  if (!d.pay) return { draft: d, asking: 'pay', options: (['cash', 'card', 'credit'] as PayMethod[]).map((p) => ({ key: p, label: PAY_LABEL[p] })), say: 'نقد، کارت یا نسیه؟' };
  if (d.pay === 'credit' && !d.creditId && !d.customerName)
    return { draft: d, asking: 'credit', options: b.credit.slice(-5).reverse().map((c) => ({ key: c.id, label: c.name })), say: 'نسیه به اسم کی؟' };
  const t = total(b, d);
  const who = d.customerName ? ` برای ${d.customerName}` : '';
  const disc = t.discountRial ? ` با تخفیف ${amountWords(t.discountRial)}،` : '';
  return {
    draft: d,
    asking: 'confirm',
    options: [
      { key: 'yes', label: 'بله، ثبت کن' },
      { key: 'no', label: 'نه، عوضش کن' },
    ],
    say: `${linesWords(d.lines)}${who}،${disc} جمعاً ${amountWords(t.totalRial)}، ${PAY_LABEL[d.pay]}. ثبت کنم؟`,
  };
}

function absorbBook(b: Business, d: BookDraft, text: string, today: Iso, asking: BizAsk): { draft: BookDraft; used: boolean } {
  const n = { ...d };
  let used = false;
  const svc = itemsIn(b, text, 'service').filter((f) => f.item);
  if (svc.length) ((n.serviceIds = [...new Set([...n.serviceIds, ...svc.map((f) => f.item!.id)])]), (used = true));
  const day = dayIn(text, today);
  if (day) ((n.day = day), (used = true));
  const time = timeIn(text);
  if (time) ((n.time = time), (used = true));
  const phone = phoneIn(text);
  if (phone) ((n.customerPhone = phone), (used = true));
  if (asking === 'phone' && RX_NOPHONE.test(clean(text))) ((n.noPhone = true), (used = true));
  const name = nameIn(text, new Set(itemsOf(b, 'service').flatMap((i) => i.words)));
  if (name) ((n.customerName = name), (used = true));
  else if (asking === 'name' && !used) {
    const bare = clean(text)
      .replace(/(^| )(اسمش|اسم|نام|به|هست|است|ه|خانم|آقای)( |$)/g, ' ')
      .trim();
    if (bare && !isNum(bare)) ((n.customerName = bare.split(' ').slice(0, 3).join(' ')), (used = true));
  }
  return { draft: n, used };
}

function nextBook(b: Business, d: BookDraft, today: Iso, now: number, note = ''): Omit<BizVoiceState, 'done' | 'misses'> {
  const pre = note ? `${note} ` : '';
  if (!d.serviceIds.length)
    return { draft: d, asking: 'service', options: b.services.filter((s) => s.active).slice(0, 8).map((s) => ({ key: s.id, label: s.name })), say: `${pre}برای چه خدمتی؟` };
  const dur = durOf(b, d.serviceIds);
  const cal = calendarOf(b);
  if (!d.day) {
    const days: Iso[] = [];
    for (let i = 0; i < 21 && days.length < 5; i++) if (availableSlots(cal, addDays(today, i), dur, now).length) days.push(addDays(today, i));
    return { draft: d, asking: 'day', options: days.map((x) => ({ key: x, label: dayWords(x, today) })), say: `${pre}چه روزی؟` };
  }
  const free = availableSlots(cal, d.day, dur, now);
  if (d.time) {
    const at = tehranMs(d.day, d.time);
    if (!withinHours(cal, at, dur) || !fits(cal, at, dur) || at < now) {
      const near = [...free].sort((x, y) => Math.abs(x - at) - Math.abs(y - at)).slice(0, 6).sort((x, y) => x - y);
      const why = at < now ? 'گذشته' : !withinHours(cal, at, dur) ? 'بیرون از ساعت کاریه' : 'پره';
      const nf = nearestFree(free, at);
      const offer = [nf.before, nf.after].filter((x): x is number => x != null).map((t) => timeWords(tehranParts(t).time));
      return {
        draft: { ...d, time: null },
        asking: 'time',
        options: near.map((t) => ({ key: tehranParts(t).time, label: faT(tehranParts(t).time) })),
        say: offer.length ? `${pre}ساعت ${timeWords(d.time)} ${why}. نزدیک‌ترین وقت خالی: ${offer.join(' یا ')}.` : `${pre}${dayWords(d.day, today)} وقت خالی نیست؛ روز دیگه‌ای بگو.`,
      };
    }
  } else
    return {
      draft: d,
      asking: free.length ? 'time' : 'day',
      options: free.slice(0, 8).map((t) => ({ key: tehranParts(t).time, label: faT(tehranParts(t).time) })),
      say: free.length ? `${pre}چه ساعتی؟ اولین وقت خالی ${dayWords(d.day, today)} ساعت ${timeWords(tehranParts(free[0]).time)}ه.` : `${pre}${dayWords(d.day, today)} وقت خالی نیست؛ روز دیگه‌ای بگو.`,
    };
  if (!d.customerName) return { draft: d, asking: 'name', options: [], say: `${pre}به اسم کی؟` };
  if (!d.customerPhone && !d.noPhone) return { draft: d, asking: 'phone', options: [{ key: 'none', label: 'شماره ندارد' }], say: `${pre}شماره موبایلش؟ اگه نداری بگو «نداره».` };
  const names = d.serviceIds.map((id) => b.services.find((s) => s.id === id)?.name).filter(Boolean).join(' و ');
  const price = d.serviceIds.reduce((s, id) => s + (b.services.find((x) => x.id === id)?.priceRial ?? 0), 0);
  return {
    draft: d,
    asking: 'confirm',
    options: [
      { key: 'yes', label: 'بله، ثبت کن' },
      { key: 'no', label: 'نه، عوضش کن' },
    ],
    say: `${pre}نوبت ${names} برای ${d.customerName}، ${dayWords(d.day, today)} ساعت ${timeWords(d.time!)}، ${numToWords(dur)} دقیقه، ${amountWords(price)}. ثبت کنم؟`,
  };
}

/** Today's (or the said day's) open bookings matching a name or a time. */
function bookingsMatching(b: Business, text: string, today: Iso): Booking[] {
  const day = dayIn(text, today) ?? today;
  const time = timeIn(text);
  const words = clean(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w) && !isNum(w));
  return b.bookings
    .filter((x) => (x.status === 'pending' || x.status === 'confirmed') && tehranParts(x.startsAt).date === day)
    .filter((x) => (time ? tehranParts(x.startsAt).time === time : true))
    .filter((x) => time || !words.length || words.some((w) => clean(x.customerName ?? '').split(' ').includes(w) || x.serviceNames.some((s) => clean(s).split(' ').includes(w))))
    .sort((x, y) => x.startsAt - y.startsAt);
}
const bookingLabel = (x: Booking) => `${faT(tehranParts(x.startsAt).time)} ${x.customerName ?? x.customerPhone} (${x.serviceNames.join(' + ')})`;

function nextFinish(b: Business, d: FinishDraft, today: Iso, cands: Booking[] | null = null): Omit<BizVoiceState, 'done' | 'misses'> & { done?: BizVoiceState['done'] } {
  if (!d.bookingId) {
    const all = bookingsMatching(b, '', today);
    const list = cands?.length ? cands : all;
    if (!list.length) return { draft: d, asking: 'which', options: [], say: 'امروز نوبت بازی نیست.', done: 'cancel' } as Omit<BizVoiceState, 'misses'>;
    return {
      draft: d,
      asking: 'which',
      options: list.slice(0, 6).map((x) => ({ key: x.id, label: bookingLabel(x) })),
      say: cands && !cands.length ? 'نوبتی با این مشخصات پیدا نکردم. کدوم نوبت؟' : 'کدوم نوبت؟',
    };
  }
  const bk = b.bookings.find((x) => x.id === d.bookingId)!;
  const who = `${bk.customerName ?? 'مشتری'} ساعت ${timeWords(tehranParts(bk.startsAt).time)}`;
  if (d.kind === 'done' && !d.pay) return { draft: d, asking: 'pay', options: (['cash', 'card', 'credit'] as PayMethod[]).map((p) => ({ key: p, label: PAY_LABEL[p] })), say: `نوبت ${who}. نقد، کارت یا نسیه؟` };
  return {
    draft: d,
    asking: 'confirm',
    options: [
      { key: 'yes', label: 'بله' },
      { key: 'no', label: 'نه' },
    ],
    say:
      d.kind === 'done'
        ? `نوبت ${who}، ${bk.serviceNames.join(' و ')}، ${amountWords(bk.priceRial)} ${PAY_LABEL[d.pay!]}، انجام شد. ثبت کنم؟`
        : `نوبت ${who} لغو بشه؟`,
  };
}

const state = (s: Omit<BizVoiceState, 'done' | 'misses'> & { done?: BizVoiceState['done'] }, misses = 0): BizVoiceState => ({ ...s, done: s.done ?? null, misses });

/**
 * A sentence that starts a business action, or null (then it is a question or a personal transaction).
 * Only for a sale verb with a product/service named, an explicit «نوبت … بذار», or «نوبت X انجام شد/لغو».
 */
export function bizStart(d: FinanceData, text: string, today: Iso, now: number): BizVoiceState | null {
  const b = d.biz;
  if (!b) return null;
  const c = clean(text);
  if (RX_BOOK.test(c) && RX_DONE.test(c)) {
    const cands = bookingsMatching(b, text, today);
    const dr: FinishDraft = { kind: 'done', bookingId: cands.length === 1 ? cands[0].id : null, pay: payIn(text) };
    return state(nextFinish(b, dr, today, cands));
  }
  if (RX_BOOK.test(c) && RX_CANCELB.test(c) && !/[?؟]/.test(text)) {
    const cands = bookingsMatching(b, text, today);
    const dr: FinishDraft = { kind: 'cancel', bookingId: cands.length === 1 ? cands[0].id : null, pay: null };
    return state(nextFinish(b, dr, today, cands));
  }
  if (RX_BOOK.test(c) && RX_BOOK_SET.test(c) && !/[?؟]/.test(text) && !/(چند|کی|کیه|چیه|کدوم)( |$)/.test(c)) {
    if (!b.services.some((s) => s.active)) return { draft: { kind: 'book', serviceIds: [], day: null, time: null, customerName: null, customerPhone: null, noPhone: false }, asking: 'service', options: [], say: 'اول در «نوبت‌دهی» خدمت‌ها را تعریف کنید.', done: 'cancel', misses: 0 };
    const r = absorbBook(b, { kind: 'book', serviceIds: [], day: null, time: null, customerName: null, customerPhone: null, noPhone: false }, text, today, 'service');
    return state(nextBook(b, r.draft, today, now));
  }
  // «امروز چند تا لاته فروختم؟» is a question, not a sale
  if ((RX_SALE.test(c) || /(^| )(دو|سه|چهار|پنج|یه|یک|\d+) تا /.test(` ${c} `)) && !/[?؟]/.test(text) && !/(^| )(چند|چقدر|چه قدر|چندتا|کی|کدوم|چی)( |$)/.test(c)) {
    const found = itemsIn(b, text);
    if (!found.length || !(RX_SALE.test(c) || payIn(text))) return null;
    const empty: SaleDraft = { kind: 'sale', lines: [], pay: null, customerName: null, customerPhone: null, creditId: null, discountId: null, pending: null };
    return state(nextSale(b, absorbSale(b, empty, text, today).draft));
  }
  return null;
}

/** «فروش با صدا» / «نوبت با صدا»: start empty and ask. */
export function bizBegin(d: FinanceData, what: 'sale' | 'book', today: Iso, now: number): BizVoiceState {
  const b = d.biz!;
  if (what === 'sale') return state(nextSale(b, { kind: 'sale', lines: [], pay: null, customerName: null, customerPhone: null, creditId: null, discountId: null, pending: null }));
  return state(nextBook(b, { kind: 'book', serviceIds: [], day: null, time: null, customerName: null, customerPhone: null, noPhone: false }, today, now));
}

const FIX_OPTS: Record<BizDraft['kind'], Option[]> = {
  sale: [
    { key: 'items', label: 'اقلام از نو' },
    { key: 'pay', label: 'روش پرداخت' },
    { key: 'cancel', label: 'لغو' },
  ],
  book: [
    { key: 'service', label: 'خدمت' },
    { key: 'day', label: 'روز' },
    { key: 'time', label: 'ساعت' },
    { key: 'name', label: 'اسم' },
    { key: 'cancel', label: 'لغو' },
  ],
  done: [
    { key: 'which', label: 'نوبت دیگر' },
    { key: 'pay', label: 'روش پرداخت' },
    { key: 'cancel', label: 'لغو' },
  ],
  cancel: [
    { key: 'which', label: 'نوبت دیگر' },
    { key: 'cancel', label: 'منصرف شدم' },
  ],
};

/** Ask again for one part (a tapped row, or «نه، … را عوض کن»). */
export function bizEdit(d: FinanceData, st: BizVoiceState, what: string, today: Iso, now: number): BizVoiceState {
  const b = d.biz!;
  const dr = st.draft;
  if (what === 'cancel') return { ...st, done: 'cancel', options: [], say: 'باشه، چیزی ثبت نشد.' };
  if (dr.kind === 'sale') {
    if (what === 'items') return state(nextSale(b, { ...dr, lines: [], pending: null }));
    if (what === 'pay') return state(nextSale(b, { ...dr, pay: null, creditId: null }));
  }
  if (dr.kind === 'book') {
    if (what === 'service') return state(nextBook(b, { ...dr, serviceIds: [], time: null }, today, now));
    if (what === 'day') return state(nextBook(b, { ...dr, day: null, time: null }, today, now));
    if (what === 'time') return state(nextBook(b, { ...dr, time: null }, today, now));
    if (what === 'name') return state(nextBook(b, { ...dr, customerName: null }, today, now));
  }
  if (dr.kind === 'done' || dr.kind === 'cancel') {
    if (what === 'which') return state(nextFinish(b, { ...dr, bookingId: null }, today));
    if (what === 'pay') return state(nextFinish(b, { ...dr, pay: null }, today));
  }
  return st;
}

/** One thing the user said (the recogniser's guesses, best first). */
export function bizAnswer(d: FinanceData, st: BizVoiceState, heard: string | string[], today: Iso, now: number): BizVoiceState {
  const b = d.biz!;
  const alts = (Array.isArray(heard) ? heard : [heard]).map((x) => x.trim()).filter(Boolean);
  if (!alts.length || st.done) return st;
  const c0 = clean(alts[0]);
  if (alts.some((a) => RX_CANCEL.test(clean(a)))) return { ...st, done: 'cancel', options: [], say: 'باشه، چیزی ثبت نشد.' };
  // a tapped option said aloud
  for (const a of alts) {
    const o = st.options.find((x) => clean(x.label) === clean(a));
    if (o) return bizChoose(d, st, o.key, today, now);
  }
  const miss = () => ({ ...st, say: `متوجه نشدم. ${st.say.replace(/^متوجه نشدم\. /, '')}`, misses: st.misses + 1 });
  const dr = st.draft;

  if (st.asking === 'confirm') {
    if (alts.some((a) => RX_YES.test(clean(a)) && !RX_NO.test(clean(a)))) return { ...st, done: 'save', options: [], say: 'ثبت شد.' };
    for (const a of alts) {
      const body = clean(a).replace(RX_NO, ' ').trim();
      if (!body) continue;
      const n = dr.kind === 'sale' ? absorbSale(b, dr, body, today) : dr.kind === 'book' ? absorbBook(b, dr, body, today, 'fix') : null;
      if (n?.used) return state(dr.kind === 'sale' ? nextSale(b, n.draft as SaleDraft) : nextBook(b, n.draft as BookDraft, today, now));
      if (dr.kind === 'done' && payIn(body)) return state(nextFinish(b, { ...dr, pay: payIn(body) }, today));
    }
    if (RX_NO.test(c0)) return state({ draft: dr, asking: 'fix', options: FIX_OPTS[dr.kind], say: 'چی رو عوض کنم؟' });
    return miss();
  }

  for (const a of alts) {
    if (dr.kind === 'sale') {
      if (st.asking === 'pick' && dr.pending) {
        const ids = dr.pending.ids;
        const hit = itemsIn(b, a).flatMap((f) => (f.item ? [f.item] : f.candidates)).find((x) => ids.includes(x.id));
        if (hit) return bizChoose(d, st, hit.id, today, now);
        continue;
      }
      const r = absorbSale(b, dr, a, today);
      if (st.asking === 'credit' && !r.used && clean(a)) {
        const name = clean(a).split(' ').slice(0, 3).join(' ');
        const cr = b.credit.find((x) => clean(x.name).includes(name));
        return state(nextSale(b, { ...r.draft, customerName: cr?.name ?? name, creditId: cr?.id ?? null }));
      }
      if (r.used) return state(nextSale(b, r.draft));
    } else if (dr.kind === 'book') {
      const r = absorbBook(b, dr, a, today, st.asking);
      if (r.used) return state(nextBook(b, r.draft, today, now));
    } else {
      if (st.asking === 'pay') {
        const p = payIn(a);
        if (p) return state(nextFinish(b, { ...dr, pay: p }, today));
      }
      if (st.asking === 'which') {
        const m = bookingsMatching(b, a, today);
        if (m.length === 1) return state(nextFinish(b, { ...dr, bookingId: m[0].id, pay: dr.pay ?? payIn(a) }, today));
      }
    }
  }
  return miss();
}

/** A tapped button. */
export function bizChoose(d: FinanceData, st: BizVoiceState, key: string, today: Iso, now: number): BizVoiceState {
  const b = d.biz!;
  const dr = st.draft;
  if (st.done) return st;
  if (st.asking === 'confirm') return key === 'yes' ? { ...st, done: 'save', options: [], say: 'ثبت شد.' } : state({ draft: dr, asking: 'fix', options: FIX_OPTS[dr.kind], say: 'چی رو عوض کنم؟' });
  if (st.asking === 'fix') return bizEdit(d, st, key, today, now);
  if (dr.kind === 'sale') {
    if (st.asking === 'pick' && dr.pending) {
      const it = itemsOf(b).find((x) => x.id === key);
      if (!it) return st;
      const n = addLines(b, { ...dr, pending: null }, [{ item: it, candidates: [it], word: it.name, qty: dr.pending.qty }]);
      return state(nextSale(b, n));
    }
    if (st.asking === 'pay') return state(nextSale(b, { ...dr, pay: key as PayMethod }));
    if (st.asking === 'credit') {
      const cr = b.credit.find((x) => x.id === key);
      return state(nextSale(b, { ...dr, creditId: key, customerName: cr?.name ?? dr.customerName }));
    }
  } else if (dr.kind === 'book') {
    if (st.asking === 'service') return state(nextBook(b, { ...dr, serviceIds: [key] }, today, now));
    if (st.asking === 'day') return state(nextBook(b, { ...dr, day: key, time: null }, today, now));
    if (st.asking === 'time') return state(nextBook(b, { ...dr, time: key }, today, now));
    if (st.asking === 'phone' && key === 'none') return state(nextBook(b, { ...dr, noPhone: true }, today, now));
  } else {
    if (st.asking === 'which') return state(nextFinish(b, { ...dr, bookingId: key }, today));
    if (st.asking === 'pay') return state(nextFinish(b, { ...dr, pay: key as PayMethod }, today));
  }
  return st;
}

/** What was recorded, so «برگرداندن» can take exactly that back. */
export type BizUndo = { kind: 'sale'; orderId: string; no: number } | { kind: 'book'; bookingId: string } | { kind: 'done' | 'cancel'; bookingId: string };

/** Records it once the user said yes. Mutates `d` (FinanceProvider.update); returns an error message or the undo. */
export function commitBiz(d: FinanceData, st: BizVoiceState, now: number): BizUndo | string {
  const b = d.biz;
  if (!b || st.done !== 'save') return 'چیزی برای ثبت نیست.';
  const dr = st.draft;
  if (dr.kind === 'sale') {
    if (!dr.lines.length || !dr.pay) return 'اقلام یا روش پرداخت معلوم نیست.';
    const o = quickSale(d, {
      items: dr.lines.map((l) => ({ itemId: l.itemId, kind: l.kind, qty: l.qty })),
      channel: 'walkin',
      customerName: dr.customerName,
      customerPhone: dr.customerPhone,
      discountId: dr.discountId,
      at: now,
      pay: dr.pay,
      creditId: dr.pay === 'credit' ? dr.creditId : null,
      deliver: true,
    });
    return typeof o === 'string' ? o : { kind: 'sale', orderId: o.id, no: o.no };
  }
  if (dr.kind === 'book') {
    if (!dr.day || !dr.time) return 'روز یا ساعت معلوم نیست.';
    const r = addBooking(b, { serviceIds: dr.serviceIds, customerName: dr.customerName, customerPhone: dr.customerPhone ?? '', startsAt: tehranMs(dr.day, dr.time), source: 'manual' }, now);
    return typeof r === 'string' ? r : { kind: 'book', bookingId: r.id };
  }
  if (!dr.bookingId) return 'نوبت معلوم نیست.';
  const err = setBookingStatus(d, dr.bookingId, dr.kind === 'done' ? 'done' : 'canceled', now, dr.pay ?? undefined);
  return err ?? { kind: dr.kind, bookingId: dr.bookingId };
}

export function undoBiz(d: FinanceData, u: BizUndo, now: number): void {
  const b = d.biz;
  if (!b) return;
  if (u.kind === 'sale') cancelOrder(d, u.orderId, now);
  else if (u.kind === 'book') b.bookings = b.bookings.filter((x) => x.id !== u.bookingId);
  else setBookingStatus(d, u.bookingId, 'confirmed', now);
}

/** For the screen: the draft as rows; tapping one asks for it again. */
export function bizRows(d: FinanceData, st: BizVoiceState, today: Iso): { key: string; label: string; value: string | null }[] {
  const b = d.biz!;
  const dr = st.draft;
  const toman = (rial: number) => `${Math.round(rial / 10).toLocaleString('fa-IR')} تومان`;
  if (dr.kind === 'sale')
    return [
      { key: 'items', label: 'اقلام', value: dr.lines.length ? dr.lines.map((l) => `${l.name}×${l.qty.toLocaleString('fa-IR')}`).join('، ') : null },
      { key: 'items', label: 'جمع', value: dr.lines.length ? toman(total(b, dr).totalRial) : null },
      { key: 'pay', label: 'پرداخت', value: dr.pay ? PAY_LABEL[dr.pay] : null },
      ...(dr.customerName || dr.pay === 'credit' ? [{ key: 'pay', label: 'مشتری', value: dr.customerName }] : []),
    ];
  if (dr.kind === 'book')
    return [
      { key: 'service', label: 'خدمت', value: dr.serviceIds.length ? dr.serviceIds.map((id) => b.services.find((s) => s.id === id)?.name).join(' + ') : null },
      { key: 'day', label: 'روز', value: dr.day ? dayWords(dr.day, today) : null },
      { key: 'time', label: 'ساعت', value: dr.time ? faT(dr.time) : null },
      { key: 'name', label: 'مشتری', value: dr.customerName },
    ];
  const bk = dr.bookingId ? b.bookings.find((x) => x.id === dr.bookingId) : null;
  return [
    { key: 'which', label: 'نوبت', value: bk ? bookingLabel(bk) : null },
    ...(dr.kind === 'done' ? [{ key: 'pay', label: 'پرداخت', value: dr.pay ? PAY_LABEL[dr.pay] : null }] : []),
  ];
}
