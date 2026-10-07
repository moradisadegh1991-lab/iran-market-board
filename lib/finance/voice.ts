// Persian voice entry for one transaction: understand what the user said, ask only for what is
// still missing, read the whole transaction back, and record it only after a «بله».
//
// Pure: text in, text out. Hearing and speaking are lib/voice-io.ts (Android's recogniser through the
// native plugin, or the browser's); nothing here touches the network, and nothing the user says
// leaves the device from this file (CLAUDE.md rule 7).
//
// What it understands (scripts/voice-test.ts pins each):
//   amounts   «پنجاه هزار تومن», «دو میلیون و پونصد», «یک و نیم میلیون», «۲٫۵ میلیون», «۱۲۰۰۰۰ ریال»,
//             «صدوبیست هزار» (glued words), spoken and written digits mixed
//   dates     امروز / دیروز / پریروز / «سه روز پیش» / «هفته پیش» / weekdays / «دوازدهم مهر» / «۱۲ مهر ۱۴۰۵»
//   kind      only from what the user says (خریدم، پرداخت، درآمد، واریز شد، انتقال…) — never guessed
//             from the category (rule 3); missing → asked
//   account   by the distinctive words of its name («ملت», «نقد»), a card the SMS sources linked
//             («کارت ۴۴۱۷»), and «از … به …» for a transfer
//   category  the user's own categories by name, everyday words (نون → خوراک, اسنپ → حمل‌ونقل) and
//             what the user picked last time for the same words (catMemory)
// Colloquial amounts are read literally and then checked: under 1000 toman with no «هزار/میلیون»
// («پنجاه تومن» often means fifty thousand) is asked about, and the read-back says the amount in words.
import { addDays, daysBetween } from './calc';
import { isGenericMemoryKey, memoryKey, norm } from './importers';
import { newId, type FinanceData, type Iso, type Txn, type TxnKind } from './model';
import { isoToJalali, jalaliMonthLength, jalaliToIso, JALALI_MONTHS } from '../jalali';

// ── text ───────────────────────────────────────────────────────────────────

/** Recogniser output → one spacing, latin digits, no punctuation; ZWNJ splits words («سه‌شنبه» = «سه شنبه»). */
export function clean(s: string): string {
  return norm(s)
    .replace(/[ً-ٰٟـ]/g, '') // harakat, tatweel
    .replace(/[‌‍]/g, ' ')
    .replace(/٫/g, '.')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[،؛؟?!,:;"«»()[\]{}…]|\.(?!\d)/g, ' ')
    .replace(/(\d)(?=[^\d\s.])/g, '$1 ')
    .replace(/([^\d\s.])(?=\d)/g, '$1 ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── numbers ────────────────────────────────────────────────────────────────

const WORD: Record<string, number> = {
  صفر: 0,
  یک: 1,
  یه: 1,
  یکی: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  چار: 4,
  پنج: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  چارده: 14,
  پانزده: 15,
  پونزده: 15,
  شانزده: 16,
  شونزده: 16,
  هفده: 17,
  هیفده: 17,
  هجده: 18,
  هیجده: 18,
  نوزده: 19,
  بیست: 20,
  سی: 30,
  چهل: 40,
  چل: 40,
  پنجاه: 50,
  پنجا: 50,
  شصت: 60,
  هفتاد: 70,
  هشتاد: 80,
  نود: 90,
  صد: 100,
  یکصد: 100,
  دویست: 200,
  دیویست: 200,
  سیصد: 300,
  چهارصد: 400,
  چارصد: 400,
  پانصد: 500,
  پونصد: 500,
  ششصد: 600,
  شیشصد: 600,
  هفتصد: 700,
  هشتصد: 800,
  نهصد: 900,
};
const MULT: Record<string, number> = { هزار: 1e3, میلیون: 1e6, ملیون: 1e6, میلیارد: 1e9, ملیارد: 1e9 };
const UNIT: Record<string, 'toman' | 'rial'> = { تومن: 'toman', تومان: 'toman', تومنی: 'toman', تومانی: 'toman', ریال: 'rial', ریالی: 'rial' };
const HALF = 'نیم';
const isDigits = (w: string) => /^\d+(\.\d+)?$/.test(w);
const isNumWord = (w: string) => w in WORD || w in MULT || w === HALF || isDigits(w);

/** «صدوبیست» / «پنجاهزار» / «صدتومن» → known pieces; null when the word is not wholly a number. */
const PIECES = [...Object.keys(WORD), ...Object.keys(MULT), ...Object.keys(UNIT), HALF, 'و'].sort((a, b) => b.length - a.length);
function segment(w: string): string[] | null {
  if (w.length < 4) return null;
  const best: (string[] | null)[] = Array(w.length + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < w.length; i++) {
    if (!best[i]) continue;
    for (const p of PIECES) if (w.startsWith(p, i) && !best[i + p.length]) best[i + p.length] = [...best[i]!, p];
  }
  const out = best[w.length];
  // «پنجاهزار»: the shared «ه» — try the word with it doubled
  if (!out && /اهزار/.test(w)) return segment(w.replace('اهزار', 'اه هزار').replace(' ', ''));
  return out && out.length > 1 && out.some((p) => p !== 'و') ? out : null;
}

export function tokens(text: string): string[] {
  return clean(text)
    .split(' ')
    .filter(Boolean)
    .flatMap((w) => (w in WORD || w in MULT || w in UNIT ? [w] : (segment(w) ?? [w])));
}

/** The value of a run of number tokens: «دو میلیون و پونصد هزار», «یک و نیم میلیون», «2.5 میلیون». */
export function numberValue(toks: string[]): { value: number; hasMult: boolean } | null {
  let total = 0;
  let cur = 0;
  let curHas = false;
  let lastMult = 0;
  let maxMult = 0;
  let any = false;
  for (const w of toks) {
    if (w === 'و') continue;
    if (isDigits(w)) ((cur += Number(w)), (curHas = true));
    else if (w in WORD) ((cur += WORD[w]), (curHas = true));
    else if (w === HALF) {
      if (!curHas && lastMult) total += lastMult / 2;
      else cur += 0.5;
      curHas = true;
    } else if (w in MULT) {
      const m = MULT[w];
      const c = curHas ? cur : 1;
      total = total > 0 && m > maxMult ? (total + c) * m : total + c * m;
      cur = 0;
      curHas = false;
      lastMult = m;
      maxMult = Math.max(maxMult, m);
    } else return null;
    any = true;
  }
  if (!any) return null;
  // «دو میلیون و پونصد» is said for 2,500,000: what trails a million or more counts in thousands
  if (curHas && lastMult >= 1e6 && cur < 1000) cur *= lastMult / 1000;
  return { value: total + cur, hasMult: maxMult > 0 };
}

interface Span {
  from: number;
  to: number; // exclusive, after any unit word
  value: number;
  unit: 'toman' | 'rial' | null;
  hasMult: boolean;
  weak: boolean;
}

/** Every run of number words in the tokens, with its unit and whether it is just «یه» or a count («دو تا»). */
function spans(toks: string[]): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!isNumWord(toks[i]) || toks[i] === 'و') continue;
    // «کارت ۴۴۱۷», «ساعت ۵»: that number is not money, but the next one may be
    if (isDigits(toks[i]) && /^(کارت|حساب|شماره|ساعت)$/.test(toks[i - 1] ?? '')) continue;
    let j = i + 1;
    // «۵ سی هزار» is two numbers: written digits and number words meet only through «هزار/میلیون» or «و»
    const joins = (a: string, b: string) => !((isDigits(a) && b in WORD) || (a in WORD && isDigits(b)));
    while (j < toks.length && ((isNumWord(toks[j]) && joins(toks[j - 1], toks[j])) || (toks[j] === 'و' && j + 1 < toks.length && isNumWord(toks[j + 1])))) j++;
    const run = toks.slice(i, j);
    const v = numberValue(run);
    if (v) {
      const unit = UNIT[toks[j]] ?? null;
      const lone = run.length === 1 && /^(یه|یک|یکی|نه)$/.test(run[0]);
      const count = toks[j] === 'تا' || toks[j] === 'عدد' || toks[j] === 'کیلو' || toks[j] === 'بار';
      out.push({ from: i, to: unit ? j + 1 : j, value: v.value, unit, hasMult: v.hasMult, weak: (lone || count) && !unit });
    }
    i = j - 1;
  }
  return out;
}

/** The amount in a sentence, in RIAL. `strict`: only a run with a unit or «هزار/میلیون», or written digits. */
export function amountIn(toks: string[], strict: boolean): { rial: number; explicit: boolean; span: Span } | null {
  const ss = spans(toks).filter((s) => s.value > 0 && (!strict || !s.weak));
  if (!ss.length) return null;
  const score = (s: Span) => (s.unit ? 4 : 0) + (s.hasMult ? 2 : 0) + (s.weak ? -5 : 0) + (s.value >= 1000 ? 1 : 0);
  const best = ss.reduce((a, b) => (score(b) > score(a) ? b : a));
  const rial = Math.round(best.unit === 'rial' ? best.value : best.value * 10);
  return { rial, explicit: best.hasMult || best.value >= 1000, span: best };
}

// ── amounts in words (what the read-back says) ─────────────────────────────

const ONES_W = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS_W = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUND_W = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(HUND_W[Math.floor(n / 100)]);
  const r = n % 100;
  if (r >= 20) {
    parts.push(TENS_W[Math.floor(r / 10)]);
    if (r % 10) parts.push(ONES_W[r % 10]);
  } else if (r) parts.push(ONES_W[r]);
  return parts.join(' و ');
}
/** 2_500_000 → «دو میلیون و پانصد هزار». Whole numbers only. */
export function numToWords(n: number): string {
  n = Math.round(Math.abs(n));
  if (n === 0) return 'صفر';
  const groups: [number, string][] = [
    [1e12, 'هزار میلیارد'],
    [1e9, 'میلیارد'],
    [1e6, 'میلیون'],
    [1e3, 'هزار'],
    [1, ''],
  ];
  const parts: string[] = [];
  for (const [g, name] of groups) {
    const k = Math.floor(n / g) % (g === 1e12 ? 1e6 : 1000);
    if (!k) continue;
    parts.push(g === 1e3 && k === 1 ? 'هزار' : `${under1000(k)}${name ? ' ' + name : ''}`);
  }
  return parts.join(' و ');
}
export function amountWords(rial: number): string {
  return rial % 10 === 0 ? `${numToWords(rial / 10)} تومان` : `${numToWords(rial)} ریال`;
}

// ── dates ──────────────────────────────────────────────────────────────────

const WEEKDAYS: [RegExp, number][] = [
  // JS getUTCDay: Sunday 0 … Saturday 6; longest names first so «سه شنبه» is not «سه» + «شنبه»
  [/(?:یک|یه) ?شنبه/, 0],
  [/دو ?شنبه/, 1],
  [/سه ?شنبه/, 2],
  [/(?:چهار|چار) ?شنبه/, 3],
  [/پنج ?شنبه/, 4],
  [/جمعه/, 5],
  [/شنبه/, 6],
];
const MONTHS_RX = JALALI_MONTHS.map((m) => (m === 'مرداد' ? 'ا?مرداد' : m)).join('|');
const ORDINAL: Record<string, number> = { اول: 1, یکم: 1, سوم: 3, سیم: 3 };

function dayNumber(words: string[]): number | null {
  const w = words.slice();
  const last = w[w.length - 1];
  if (last === 'ام') w.pop();
  else if (last in ORDINAL) w[w.length - 1] = ORDINAL[last] === 3 ? 'سه' : 'یک';
  else if (!isNumWord(last) && /م$/.test(last) && isNumWord(last.slice(0, -1))) w[w.length - 1] = last.slice(0, -1);
  const v = numberValue(w);
  return v && Number.isInteger(v.value) && v.value >= 1 && v.value <= 31 ? v.value : null;
}

/** A date in the sentence → { iso, rest } with the date words taken out; null when none. Past dates only make sense. */
export function dateIn(text: string, today: Iso): { iso: Iso; rest: string } | null {
  let t = ` ${clean(text)} `;
  const take = (rx: RegExp) => {
    const m = t.match(rx);
    if (m) t = t.replace(rx, ' ');
    return m;
  };
  if (take(/ پریروز /)) return { iso: addDays(today, -2), rest: t.trim() };
  if (take(/ (دیروز|دیشب) /)) return { iso: addDays(today, -1), rest: t.trim() };
  let m = take(/ ((?:[^\s]+ و )?[^\s]+) روز (?:پیش|قبل) /);
  if (m) {
    const v = numberValue(tokens(m[1]));
    if (v && v.value >= 1 && v.value <= 400) return { iso: addDays(today, -Math.round(v.value)), rest: t.trim() };
  }
  if (take(/ (?:یه |یک )?هفته (?:پیش|قبل|گذشته) /)) return { iso: addDays(today, -7), rest: t.trim() };
  // «دوازدهم مهر», «۱۲ مهر ۱۴۰۵», «بیست و یکم آبان»
  m = take(new RegExp(` ((?:[^\\s]+ و )?[^\\s]+(?: ام)?) (${MONTHS_RX})(?: (1[34]\\d\\d))? `));
  if (m) {
    const day = dayNumber(m[1].split(' '));
    const jm = JALALI_MONTHS.indexOf(m[2].replace(/^امرداد$/, 'مرداد')) + 1;
    if (day && jm) {
      const now = isoToJalali(today);
      let jy = m[3] ? Number(m[3]) : now.jy;
      const fits = (y: number) => day <= jalaliMonthLength(y, jm);
      if (!m[3] && fits(jy) && jalaliToIso(jy, jm, day) > today) jy -= 1;
      if (fits(jy)) return { iso: jalaliToIso(jy, jm, day), rest: t.trim() };
    }
  }
  for (const [rx, wd] of WEEKDAYS) {
    m = take(new RegExp(` (${rx.source})( (?:پیش|قبل|گذشته))? `));
    if (m) {
      const todayWd = new Date(`${today}T00:00:00Z`).getUTCDay();
      let back = (todayWd - wd + 7) % 7;
      if (back === 0 && m[2]) back = 7;
      return { iso: addDays(today, -back), rest: t.trim() };
    }
  }
  if (take(/ (امروز|امشب|الان|همین الان) /)) return { iso: today, rest: t.trim() };
  return null;
}

/** «امروز» / «دیروز» / «۱۲ مهر» / «۱۲ مهر ۱۴۰۴» — how the read-back says a date. */
export function dateWords(iso: Iso, today: Iso): string {
  const back = daysBetween(iso, today);
  if (back === 0) return 'امروز';
  if (back === 1) return 'دیروز';
  if (back === 2) return 'پریروز';
  const j = isoToJalali(iso);
  const fa = (n: number) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);
  return `${fa(j.jd)} ${JALALI_MONTHS[j.jm - 1]}${j.jy !== isoToJalali(today).jy ? ' ' + fa(j.jy) : ''}`;
}

// ── kind, account, category ────────────────────────────────────────────────

const has = (text: string, rx: RegExp) => rx.test(` ${text} `);
const RX_TRANSFER = / (انتقال|منتقل|جابه ?جا|جابجا)/;
const RX_INCOME =
  / (درآمد|درامد|دریافت|دریافتی|واریز (شد|کرد|کردن|کردند)|ریختن|ریختند|ریخت به حسابم|به حسابم|اومد به حساب|آمد به حساب|فروختم|فروختیم|حقوقم? (اومد|آمد|گرفتم|گرفتیم|ریختن)|سود (گرفتم|اومد|آمد)|طلبم|پس داد|پس دادن)/;
const RX_EXPENSE = / (هزینه|خرج|خریدم|خریدیم|خرید|پرداخت|پرداختم|پرداختیم|دادم|دادیم|حساب کردم|کرایه دادم|اجاره دادم)( |$)/;

/** The kind only when the user said it; both or neither → null, and the assistant asks (rule 3). */
export function kindIn(text: string): TxnKind | null {
  const c = clean(text);
  if (has(c, RX_TRANSFER)) return 'transfer';
  const inc = has(c, RX_INCOME);
  const exp = has(c, RX_EXPENSE);
  return inc === exp ? null : inc ? 'income' : 'expense';
}

const GENERIC = new Set(['بانک', 'حساب', 'کارت', 'کیف', 'پول', 'سپرده', 'جاری', 'قرض', 'الحسنه', 'قرضالحسنه', 'پس', 'انداز', 'پسانداز', 'من', 'صندوق', 'درآمد', 'ثابت', 'و']);
const nameWords = (name: string) =>
  clean(name)
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC.has(w));
const wordHit = (said: string[], w: string) => said.some((s) => s === w || (w.length >= 3 && s.startsWith(w) && s.length - w.length <= 2));

export interface Hit {
  id: string;
  at: number; // first token index of the match
  score: number;
}

/** Accounts the sentence names, best first, each with where it was said. */
export function accountHits(d: FinanceData, text: string): Hit[] {
  const said = clean(text).split(' ');
  const live = d.accounts.filter((a) => !a.archived && a.kind !== 'person');
  const hits: Hit[] = [];
  for (const a of live) {
    const ws = nameWords(a.name);
    let at = -1;
    let score = 0;
    for (const w of ws) {
      const i = said.findIndex((s) => s === w || (w.length >= 3 && s.startsWith(w) && s.length - w.length <= 2));
      if (i >= 0) ((score += 2), (at = at < 0 ? i : Math.min(at, i)));
    }
    if (!ws.length) {
      const i = clean(text).indexOf(clean(a.name));
      if (i >= 0) ((score = 2), (at = clean(text).slice(0, i).split(' ').length - 1));
    }
    if (a.kind === 'cash' && live.filter((x) => x.kind === 'cash').length === 1) {
      const i = said.findIndex((s) => /^(نقد|نقدی|نقدا|کش|اسکناس)$/.test(s));
      if (i >= 0) ((score += 2), (at = at < 0 ? i : Math.min(at, i)));
    }
    if (score) hits.push({ id: a.id, at, score });
  }
  // «کارت ۴۴۱۷» → the account that card was linked to from SMS (rule 45)
  const c = clean(text);
  for (const m of c.matchAll(/کارت (\d{4})\b/g)) {
    const src = d.smsSources.find((s) => s.key === `card:${m[1]}` && s.accountId && live.some((a) => a.id === s.accountId));
    if (src) {
      const at = c.slice(0, m.index).split(' ').length - 1;
      const h = hits.find((x) => x.id === src.accountId);
      if (h) h.score += 3;
      else hits.push({ id: src.accountId!, at, score: 3 });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.at - b.at);
}

/** Everyday words → the default categories (prefix match on the word). */
const CAT_WORDS: Record<string, string[]> = {
  'c-food': [
    'نون',
    'نان',
    'غذا',
    'ناهار',
    'نهار',
    'شام',
    'صبحانه',
    'صبحونه',
    'رستوران',
    'میوه',
    'سوپر',
    'خوراک',
    'خوراکی',
    'قهوه',
    'کافه',
    'بقالی',
    'گوشت',
    'مرغ',
    'برنج',
    'لبنیات',
    'شیر',
    'ماست',
    'پنیر',
    'تخم',
    'سبزی',
    'فست',
    'پیتزا',
    'ساندویچ',
    'هایپر',
    'افطار',
    'خواربار',
    'اسنپ فود',
    'اسنپفود',
  ],
  'c-home': ['اجاره', 'رهن', 'اجارهخونه', 'تعمیر', 'لوله', 'مبل', 'وسایل خونه'],
  'c-bills': ['قبض', 'برق', 'گاز', 'آب', 'تلفن', 'موبایل', 'اینترنت', 'شارژ', 'بسته', 'مخابرات', 'آنتن'],
  'c-transport': ['بنزین', 'تاکسی', 'اسنپ', 'تپسی', 'مترو', 'اتوبوس', 'پارکینگ', 'ماشین', 'کارواش', 'عوارض', 'بلیت', 'بلیط', 'قطار', 'هواپیما', 'آژانس', 'سوخت', 'تعویض روغن', 'لاستیک'],
  'c-health': ['دارو', 'داروخانه', 'دکتر', 'پزشک', 'دندون', 'دندان', 'آزمایش', 'بیمارستان', 'درمان', 'ویزیت', 'عینک', 'بیمه'],
  'c-edu': ['شهریه', 'کتاب', 'کلاس', 'دوره', 'مدرسه', 'دانشگاه', 'آموزش', 'کنکور', 'لوازم التحریر'],
  'c-shop': ['لباس', 'کفش', 'پیراهن', 'شلوار', 'گوشی', 'لپ تاپ', 'لوازم', 'آرایشی', 'بهداشتی', 'کیف', 'ساعت', 'خرید'],
  'c-fun': ['سینما', 'تفریح', 'مسافرت', 'سفر', 'هتل', 'کنسرت', 'بازی', 'پارک', 'کافی شاپ', 'رستوران گردی'],
  'c-loan': ['قسط', 'اقساط', 'وام', 'بدهی', 'تسهیلات'],
  'c-gift': ['هدیه', 'کادو', 'عیدی', 'کمک', 'صدقه', 'نذر', 'خیریه'],
  'i-salary': ['حقوق', 'دستمزد', 'مزایا', 'پاداش', 'اضافه کار'],
  'i-freelance': ['پروژه', 'فریلنس', 'کار آزاد', 'سفارش', 'مشاوره', 'تدریس'],
  'i-invest': ['سود', 'بهره', 'سپرده'],
  'i-rent': ['اجاره', 'کرایه خونه', 'مستاجر'],
  'i-loanback': ['طلب', 'قرض', 'پس داد'],
};
const OTHER = /(^| )(سایر|بقیه|متفرقه|نمیدونم|نمی دونم|نمیدانم|هیچی|فرقی نمیکنه|مهم نیست|بیخیال دسته)( |$)/;

/** The category the sentence names, of `kind` when known; the user's own names beat everyday words. */
const VERBS = /^(خرید|خریدم|خریدیم|خریدن|بخرم|پرداخت|پرداختم|پرداختیم|دادم|دادیم|گرفتم|گرفتیم|کردم|کردیم)$/;
export function categoryIn(d: FinanceData, text: string, kind: TxnKind | null, note: string, answering = false): string | null {
  const want = kind === 'income' ? 'income' : kind === 'expense' ? 'expense' : null;
  const cats = d.categories.filter((c) => !want || c.kind === want);
  // «خریدم» is the verb, not the category «خرید» — unless it is the answer to «دسته‌اش چیست؟»
  const c = answering
    ? clean(text)
    : clean(text)
        .split(' ')
        .filter((w) => !VERBS.test(w))
        .join(' ');
  const said = c.split(' ');
  // what the user chose last time for the same words (TxnForm/voice remember it)
  const mk = memoryKey(note);
  if (mk && !isGenericMemoryKey(mk)) {
    const mem = d.catMemory[`voice:${mk}`];
    if (mem && cats.some((x) => x.id === mem)) return mem;
  }
  let best: { id: string; score: number } | null = null;
  for (const cat of cats) {
    let score = 0;
    const ws = clean(cat.name)
      .split(' ')
      .filter((w) => w.length > 1 && w !== 'و');
    if (ws.length && ws.some((w) => wordHit(said, w))) score = 3;
    for (const w of CAT_WORDS[cat.id] ?? []) if (w.includes(' ') ? ` ${c} `.includes(` ${w} `) : wordHit(said, w)) score = Math.max(score, 2);
    if (score && (!best || score > best.score)) best = { id: cat.id, score };
  }
  if (best) return best.id;
  if (OTHER.test(c) && want) return cats.find((x) => /^(i|c)-other$/.test(x.id))?.id ?? cats.find((x) => /سایر/.test(x.name))?.id ?? null;
  return null;
}

// filler that is not «what it was for»
const FILLER = new Set(
  'از به با برای بابت رو را هم و که این اون اینو اونو یه یک تا چیزی چیز یچیزی من ما کردم کردیم کرد شد بود بودم داشتم امروز دیروز پریروز تومن تومان ریال هزار میلیون میلیارد نیم خریدم خریدیم خرید پرداخت پرداختم دادم دادیم هزینه خرج درآمد دریافت واریز انتقال منتقل حساب کارت بانک کیف پول نقد نقدی ثبت کن بکن لطفا لطفاً بزن اومد آمد ریختن گرفتم گرفتیم پیش قبل روز هفته گذشته'.split(
    ' ',
  ),
);

/** What is left of the sentence after the amount, date, account and verbs: «نون», «بنزین ماشین». */
function noteOf(d: FinanceData, rest: string, amountSpan: Span | null): string {
  const toks = tokens(rest);
  const drop = new Set<number>();
  if (amountSpan) for (let i = amountSpan.from; i < amountSpan.to; i++) drop.add(i);
  const accWords = d.accounts.flatMap((a) => nameWords(a.name));
  const left = toks.filter((w, i) => !drop.has(i) && !FILLER.has(w) && !isNumWord(w) && !(w in UNIT) && !accWords.includes(w) && !/^\d+$/.test(w));
  const note = left.join(' ').trim();
  return note.length > 40 ? '' : note;
}

// ── the conversation ───────────────────────────────────────────────────────

export type Ask = 'open' | 'amount' | 'scale' | 'kind' | 'account' | 'toAccount' | 'category' | 'date' | 'confirm' | 'fix';
export interface Draft {
  amountRial: number | null;
  /** the amount was said with «هزار/میلیون» or is over 1000 toman, or the user confirmed it */
  scaleOk: boolean;
  kind: TxnKind | null;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  date: Iso;
  note: string;
}
export interface Option {
  key: string;
  label: string;
}
export interface Turn {
  who: 'bot' | 'me';
  text: string;
}
export interface VoiceState {
  draft: Draft;
  asking: Ask;
  options: Option[];
  /** what the assistant says now (spoken and shown) */
  say: string;
  turns: Turn[];
  done: null | 'save' | 'cancel';
  /** answers in a row it could not use — the screen leans on the buttons after two */
  misses: number;
}

export const KIND_LABEL: Record<TxnKind, string> = { expense: 'هزینه', income: 'درآمد', transfer: 'انتقال' };
const RX_CANCEL = /(^| )(لغو|کنسل|بیخیال|بی خیال|ولش کن|نمیخوام|نمی خوام|ثبت نکن|منصرف)( |$)/;
const RX_REPEAT = /^(چی|چی گفتی|دوباره|تکرار|تکرار کن|دوباره بگو|نفهمیدم)$/;
const RX_YES = /^(بله|بلی|آره|اره|آری|باشه|اوکی|اوکیه|ok|okay|yes|حتما|درسته|درست|درسته ثبت کن|ثبت کن|ثبتش کن|بزن|آره ثبت کن|بله ثبت کن|همینه|خوبه|عالیه|تایید|تأیید|چرا که نه)( .*)?$/;
const RX_NO = /^(نه|نخیر|خیر|نچ|no|غلطه|اشتباهه|درست نیست)( |$)/;
const ORD = ['اولی', 'دومی', 'سومی', 'چهارمی', 'پنجمی', 'ششمی'];

function liveAccounts(d: FinanceData) {
  return d.accounts.filter((a) => !a.archived && a.kind !== 'person');
}
function accName(d: FinanceData, id: string | null) {
  return d.accounts.find((a) => a.id === id)?.name ?? '';
}
function catName(d: FinanceData, id: string | null) {
  return d.categories.find((c) => c.id === id)?.name ?? '';
}

/** An option the user named: «دومی», its number, or (part of) its label. */
function pickOption(options: Option[], text: string): string | null {
  const c = clean(text);
  const ord = ORD.findIndex((o) => c.split(' ').includes(o));
  if (ord >= 0 && ord < options.length) return options[ord].key;
  for (const o of options) if (clean(o.label) === c) return o.key;
  return null;
}

export function startVoice(d: FinanceData, today: Iso): VoiceState {
  const st: VoiceState = {
    draft: { amountRial: null, scaleOk: false, kind: null, accountId: null, toAccountId: null, categoryId: null, date: today, note: '' },
    asking: 'open',
    options: [],
    say: '',
    turns: [],
    done: null,
    misses: 0,
  };
  if (!liveAccounts(d).length) return { ...st, done: 'cancel', say: 'اول یک حساب بسازید؛ بعد می‌شود با صدا تراکنش ثبت کرد.' };
  st.say = 'چه تراکنشی ثبت کنم؟ مثلاً بگو: پنجاه هزار تومن نون خریدم از کیف پول.';
  st.turns = [{ who: 'bot', text: st.say }];
  return st;
}

/** Fills the draft from one sentence. `asking` lets a bare answer («ملت», «سی هزار») mean the asked thing. */
function absorb(d: FinanceData, today: Iso, dr: Draft, text: string, asking: Ask, options: Option[]): { draft: Draft; used: boolean; badDate?: boolean } {
  const n: Draft = { ...dr };
  let used = false;
  let badDate = false;
  const picked = pickOption(options, text);

  const dt = dateIn(text, today);
  let rest = dt ? dt.rest : clean(text);
  if (dt) {
    if (dt.iso > today) badDate = true;
    else ((n.date = dt.iso), (used = true));
  } else if (asking === 'date') {
    // «دوازدهم» alone: that day of this month (or last month, if it has not come yet)
    const day = dayNumber(tokens(text));
    if (day) {
      const j = isoToJalali(today);
      let [jy, jm] = [j.jy, j.jm];
      if (day > j.jd) [jy, jm] = jm === 1 ? [jy - 1, 12] : [jy, jm - 1];
      if (day <= jalaliMonthLength(jy, jm)) ((n.date = jalaliToIso(jy, jm, day)), (used = true), (rest = ''));
    }
  }

  const toks = tokens(rest);
  // the amount: in an open sentence only a clear one; when asked, any number
  const amt = asking === 'scale' ? null : amountIn(toks, asking !== 'amount' && asking !== 'fix');
  if (amt && asking !== 'date') {
    n.amountRial = amt.rial;
    n.scaleOk = amt.explicit;
    used = true;
  }
  if (asking === 'scale' && n.amountRial) {
    const c = clean(rest);
    const base = n.amountRial;
    const fresh = amountIn(toks, false);
    if (picked) ((n.amountRial = Number(picked)), (n.scaleOk = true), (used = true));
    else if (fresh && fresh.explicit && toks.some((w) => w in WORD || isDigits(w))) ((n.amountRial = fresh.rial), (n.scaleOk = true), (used = true));
    else if (/(^| )(میلیون|ملیون)( |$)/.test(c)) ((n.amountRial = base * 1e6), (n.scaleOk = true), (used = true));
    else if (/(^| )هزار( |$)/.test(c)) ((n.amountRial = base * 1e3), (n.scaleOk = true), (used = true));
    else if (RX_YES.test(c) || /(^| )(همون|همین|تومن|تومان|درسته)( |$)/.test(c)) ((n.scaleOk = true), (used = true));
  }

  const kind = asking === 'kind' && picked ? (picked as TxnKind) : (kindIn(rest) ?? (asking === 'kind' ? kindAnswer(rest) : null));
  if (kind) ((n.kind = kind), (used = true));

  // accounts: «از X به Y» for a transfer; otherwise the one named
  const hits = accountHits(d, rest);
  const said = clean(rest).split(' ');
  const prep = (h: Hit) =>
    said
      .slice(Math.max(0, h.at - 2), h.at)
      .reverse()
      .find((w) => w === 'از' || w === 'به') ?? null;
  if ((asking === 'account' || asking === 'toAccount') && picked) {
    if (asking === 'account') n.accountId = picked;
    else n.toAccountId = picked;
    used = true;
  } else if (hits.length) {
    const top = hits.filter((h) => h.score === hits[0].score);
    if (n.kind === 'transfer' && hits.length >= 2 && asking !== 'account' && asking !== 'toAccount') {
      const two = hits.slice(0, 2).sort((a, b) => a.at - b.at);
      const [from, to] = prep(two[1]) === 'از' || prep(two[0]) === 'به' ? [two[1], two[0]] : two;
      n.accountId = from.id;
      n.toAccountId = to.id;
      used = true;
    } else if (top.length === 1 || asking === 'account' || asking === 'toAccount') {
      const h = hits[0];
      if (asking === 'toAccount' || (n.kind === 'transfer' && asking !== 'account' && prep(h) === 'به' && n.accountId)) n.toAccountId = h.id;
      else n.accountId = h.id;
      used = true;
    }
  }

  const note = asking === 'open' || asking === 'amount' ? noteOf(d, rest, amt?.span ?? null) : '';
  if (note) n.note = note;
  const cat = asking === 'category' && picked ? picked : categoryIn(d, rest, n.kind, n.note, asking === 'category' || asking === 'fix');
  if (cat) ((n.categoryId = cat), (used = true));
  // a kind said later can rule out the category picked before it
  if (n.categoryId && n.kind && n.kind !== 'transfer') {
    const ck = d.categories.find((c) => c.id === n.categoryId)?.kind;
    if (ck && ck !== n.kind) n.categoryId = categoryIn(d, `${rest} ${n.note}`, n.kind, n.note);
  }
  if (n.kind === 'transfer') n.categoryId = null;
  // a note alone («هوا چطوره») is not a transaction: something concrete must have been said
  return { draft: n, used, badDate };
}

function kindAnswer(text: string): TxnKind | null {
  const c = ` ${clean(text)} `;
  if (/ (هزینه|خرج|خرید|پرداخت|برداشت|رفت) /.test(c)) return 'expense';
  if (/ (درآمد|درامد|دریافت|دریافتی|واریز|گرفتم|اومد|آمد|ورودی) /.test(c)) return 'income';
  if (/ (انتقال|جابجا|جابه جا|بین حسابا|بین حساب ها) /.test(c)) return 'transfer';
  return null;
}

/** What to ask next for this draft — the first thing still missing, then the read-back. */
function next(d: FinanceData, today: Iso, dr: Draft, prefix = ''): Pick<VoiceState, 'asking' | 'options' | 'say' | 'draft'> {
  const accts = liveAccounts(d);
  const n = { ...dr };
  const q = (asking: Ask, say: string, options: Option[] = []) => ({ asking, options, say: prefix + say, draft: n });
  if (!n.amountRial) return q('amount', 'مبلغش چقدر بود؟');
  if (!n.scaleOk) {
    const t = n.amountRial / 10;
    const opts = [n.amountRial, n.amountRial * 1e3, n.amountRial * 1e6].map((r) => ({ key: String(r), label: amountWords(r) }));
    return q('scale', `${amountWords(n.amountRial)}، یا ${numToWords(t)} هزار تومان؟`, opts);
  }
  if (!n.kind)
    return q(
      'kind',
      'هزینه بود، درآمد، یا انتقال بین حساب‌های خودت؟',
      (['expense', 'income', 'transfer'] as const).map((k) => ({ key: k, label: KIND_LABEL[k] })),
    );
  if (!n.accountId && accts.length === 1) n.accountId = accts[0].id;
  if (!n.accountId) {
    const opts = accts.map((a) => ({ key: a.id, label: a.name }));
    const eg = accts
      .slice(0, 3)
      .map((a) => a.name)
      .join('، ');
    return q('account', n.kind === 'income' ? `به کدام حساب آمد؟ ${eg}؟` : n.kind === 'transfer' ? `از کدام حساب؟ ${eg}؟` : `از کدام حساب یا کارت؟ ${eg}؟`, opts);
  }
  if (n.kind === 'transfer') {
    if (n.toAccountId === n.accountId) n.toAccountId = null;
    const others = accts.filter((a) => a.id !== n.accountId);
    if (!others.length)
      return q('kind', 'برای انتقال دو حساب لازم است و فقط یک حساب دارید. هزینه بود یا درآمد؟', [
        { key: 'expense', label: KIND_LABEL.expense },
        { key: 'income', label: KIND_LABEL.income },
      ]);
    if (!n.toAccountId && others.length === 1) n.toAccountId = others[0].id;
    if (!n.toAccountId)
      return q(
        'toAccount',
        `به کدام حساب منتقل شد؟ ${others
          .slice(0, 3)
          .map((a) => a.name)
          .join('، ')}؟`,
        others.map((a) => ({ key: a.id, label: a.name })),
      );
  } else if (!n.categoryId) {
    const cats = d.categories.filter((c) => c.kind === n.kind);
    return q(
      'category',
      `دسته‌اش چیست؟ مثلاً ${cats
        .slice(0, 3)
        .map((c) => c.name)
        .join('، ')}.`,
      cats.map((c) => ({ key: c.id, label: `${c.emoji} ${c.name}` })),
    );
  }
  return q('confirm', readBack(d, today, n), [
    { key: 'yes', label: 'بله، ثبت کن' },
    { key: 'no', label: 'نه، عوض کن' },
  ]);
}

/** The whole transaction in one sentence, then «ثبت کنم؟» — and a warning when the same one is already in the book. */
export function readBack(d: FinanceData, today: Iso, n: Draft): string {
  const where = n.kind === 'transfer' ? `از ${accName(d, n.accountId)} به ${accName(d, n.toAccountId)}` : n.kind === 'income' ? `به ${accName(d, n.accountId)}` : `از ${accName(d, n.accountId)}`;
  const parts = [`${amountWords(n.amountRial!)} ${KIND_LABEL[n.kind!]}`];
  if (n.kind !== 'transfer') parts.push(`دسته ${catName(d, n.categoryId)}`);
  parts.push(where, dateWords(n.date, today));
  if (n.note) parts.push(`بابت ${n.note}`);
  const dup = d.txns.some((t) => t.date === n.date && t.amountRial === n.amountRial && t.kind === n.kind);
  return `${parts.join('، ')}.${dup ? ' همین مبلغ در همین روز یک بار ثبت شده.' : ''} ثبت کنم؟`;
}

const FIX: [RegExp, Ask][] = [
  [/(مبلغ|پول|قیمت|عدد|رقم)/, 'amount'],
  [/(نوع|نوعش)/, 'kind'],
  [/(مقصد|به حساب)/, 'toAccount'],
  [/(حساب|کارت|بانک)/, 'account'],
  [/(دسته|دستش|دسته بندی)/, 'category'],
  [/(تاریخ|روز|زمان|کی بود)/, 'date'],
];

/**
 * One answer → the next state. `heard` is the recogniser's alternatives, best first: the first one that
 * moves the conversation forward wins, so a misheard top guess does not cost a question.
 */
export function answer(d: FinanceData, today: Iso, st: VoiceState, heard: string | string[]): VoiceState {
  const alts = (Array.isArray(heard) ? heard : [heard]).map((x) => x.trim()).filter(Boolean);
  if (!alts.length || st.done) return st;
  const turns: Turn[] = [...st.turns];
  const reply = (s: Partial<VoiceState>, said: string): VoiceState => ({ ...st, ...s, turns: [...turns, { who: 'me', text: said }, { who: 'bot', text: s.say ?? st.say }] });
  const c0 = clean(alts[0]);

  if (alts.some((a) => RX_CANCEL.test(clean(a)))) return reply({ done: 'cancel', say: 'باشه، چیزی ثبت نشد.', options: [] }, alts[0]);
  if (RX_REPEAT.test(c0)) return reply({}, alts[0]);

  if (st.asking === 'confirm') {
    const yes = alts.find((a) => RX_YES.test(clean(a)) && !RX_NO.test(clean(a)));
    if (yes || pickOption(st.options, alts[0]) === 'yes') return reply({ done: 'save', say: 'ثبت شد.', options: [] }, yes ?? alts[0]);
    // «نه، شصت هزار بود» → change that and read back again; a bare «نه» → ask what to change
    for (const a of alts) {
      const body = clean(a).replace(RX_NO, ' ').trim();
      if (!body) continue;
      const r = absorb(d, today, st.draft, body, 'fix', []);
      if (r.used) return reply({ ...next(d, today, { ...r.draft, scaleOk: r.draft.scaleOk || r.draft.amountRial === st.draft.amountRial }), misses: 0 }, a);
      const f = FIX.find(([rx]) => rx.test(body));
      if (f) return reply(askFor(d, today, st.draft, f[1]), a);
    }
    if (alts.some((a) => RX_NO.test(clean(a))) || pickOption(st.options, alts[0]) === 'no')
      return reply(
        {
          asking: 'fix',
          say: 'چه چیزی را عوض کنم؟ مبلغ، نوع، حساب، دسته یا تاریخ؟',
          options: [
            { key: 'amount', label: 'مبلغ' },
            { key: 'kind', label: 'نوع' },
            { key: 'account', label: 'حساب' },
            { key: st.draft.kind === 'transfer' ? 'toAccount' : 'category', label: st.draft.kind === 'transfer' ? 'حساب مقصد' : 'دسته' },
            { key: 'date', label: 'تاریخ' },
          ],
          misses: 0,
        },
        alts[0],
      );
    return reply({ say: `متوجه نشدم. ${st.say}`, misses: st.misses + 1 }, alts[0]);
  }

  if (st.asking === 'fix') {
    for (const a of alts) {
      const picked = pickOption(st.options, a) as Ask | null;
      const f = picked ?? FIX.find(([rx]) => rx.test(clean(a)))?.[1];
      if (f) return reply(askFor(d, today, st.draft, f), a);
      const r = absorb(d, today, st.draft, a, 'fix', []);
      if (r.used) return reply({ ...next(d, today, r.draft), misses: 0 }, a);
    }
    return reply({ say: `متوجه نشدم. ${st.say}`, misses: st.misses + 1 }, alts[0]);
  }

  for (const a of alts) {
    const r = absorb(d, today, st.draft, a, st.asking, st.options);
    if (r.badDate) return reply({ ...askFor(d, today, r.draft, 'date'), say: 'تاریخ نمی‌تواند در آینده باشد؛ پرداخت آینده را در «وام، چک و قبض» ثبت کنید. چه روزی بود؟' }, a);
    const moved = r.used && (st.asking === 'open' || filled(r.draft, st.asking) || r.draft.amountRial !== st.draft.amountRial);
    if (moved) {
      const draft = st.asking === 'account' && r.draft.accountId === null ? st.draft : r.draft;
      return reply({ ...next(d, today, draft), misses: 0 }, a);
    }
  }
  return reply({ say: `متوجه نشدم. ${st.say.replace(/^متوجه نشدم\. /, '')}`, misses: st.misses + 1 }, alts[0]);
}

function filled(dr: Draft, asking: Ask): boolean {
  switch (asking) {
    case 'amount':
      return !!dr.amountRial;
    case 'scale':
      return dr.scaleOk;
    case 'kind':
      return !!dr.kind;
    case 'account':
      return !!dr.accountId;
    case 'toAccount':
      return !!dr.toAccountId;
    case 'category':
      return !!dr.categoryId;
    case 'date':
      return true;
    default:
      return false;
  }
}

/** Ask for one field again (from «نه، عوض کن»), clearing it so the answer replaces it. */
function askFor(d: FinanceData, today: Iso, dr: Draft, what: Ask): Partial<VoiceState> {
  const n: Draft = { ...dr };
  if (what === 'date') {
    return { asking: 'date', options: [-0, -1, -2].map((k) => ({ key: `d${-k}`, label: dateWords(addDays(today, k), today) })), say: 'چه روزی بود؟ مثلاً دیروز، یا دوازدهم مهر.', draft: n, misses: 0 };
  }
  if (what === 'amount') ((n.amountRial = null), (n.scaleOk = false));
  if (what === 'kind') ((n.kind = null), (n.categoryId = null), (n.toAccountId = null));
  if (what === 'account') n.accountId = null;
  if (what === 'toAccount') n.toAccountId = null;
  if (what === 'category') n.categoryId = null;
  const r = next(d, today, n);
  // a field the next() fills by itself (the only account) would never be asked: ask it anyway
  if (r.asking === 'confirm' && (what === 'account' || what === 'toAccount')) {
    const accts = liveAccounts(d);
    return { asking: what, options: accts.map((a) => ({ key: a.id, label: a.name })), say: what === 'account' ? 'کدام حساب؟' : 'به کدام حساب؟', draft: n, misses: 0 };
  }
  return { ...r, misses: 0 };
}

/** Tapping a row of the draft on the screen: ask that field again. */
export function edit(d: FinanceData, today: Iso, st: VoiceState, what: Ask): VoiceState {
  if (st.done === 'save') return st;
  const s = askFor(d, today, st.draft, what);
  return { ...st, ...s, done: null, turns: [...st.turns, { who: 'bot', text: s.say ?? st.say }] } as VoiceState;
}

/** A tapped button: the same as saying its label, but exact. */
export function choose(d: FinanceData, today: Iso, st: VoiceState, key: string): VoiceState {
  const o = st.options.find((x) => x.key === key);
  if (!o || st.done) return st;
  const said = o.label;
  const turns: Turn[] = [...st.turns, { who: 'me', text: said }];
  const done = (s: Partial<VoiceState>): VoiceState => {
    const out = { ...st, ...s, misses: 0 } as VoiceState;
    return { ...out, turns: [...turns, { who: 'bot', text: out.say }] };
  };
  if (st.asking === 'confirm') return key === 'yes' ? done({ done: 'save', say: 'ثبت شد.', options: [] }) : answer(d, today, st, 'نه');
  if (st.asking === 'fix') return done(askFor(d, today, st.draft, key as Ask));
  const n: Draft = { ...st.draft };
  if (st.asking === 'scale') ((n.amountRial = Number(key)), (n.scaleOk = true));
  else if (st.asking === 'kind') {
    n.kind = key as TxnKind;
    if (n.categoryId && d.categories.find((c) => c.id === n.categoryId)?.kind !== n.kind) n.categoryId = categoryIn(d, n.note, n.kind, n.note);
  } else if (st.asking === 'account') n.accountId = key;
  else if (st.asking === 'toAccount') n.toAccountId = key;
  else if (st.asking === 'category') n.categoryId = key;
  else if (st.asking === 'date') n.date = addDays(today, -Number(key.slice(1)));
  return done(next(d, today, n));
}

/** The transaction to record, once the user said yes. Mutates `d` (FinanceProvider.update). */
export function commitVoice(d: FinanceData, st: VoiceState): Txn | null {
  const n = st.draft;
  if (st.done !== 'save' || !n.amountRial || n.amountRial <= 0 || !n.kind || !n.accountId) return null;
  if (!d.accounts.some((a) => a.id === n.accountId)) return null;
  if (n.kind === 'transfer' && (!n.toAccountId || n.toAccountId === n.accountId)) return null;
  const t: Txn = {
    id: newId('t'),
    date: n.date,
    kind: n.kind,
    amountRial: n.amountRial,
    accountId: n.accountId,
    toAccountId: n.kind === 'transfer' ? n.toAccountId : null,
    categoryId: n.kind === 'transfer' ? null : n.categoryId,
    note: n.note || undefined,
  };
  d.txns.push(t);
  // remember «نون» → خوراک for next time (only words that name something)
  const mk = memoryKey(n.note);
  if (t.categoryId && mk && !isGenericMemoryKey(mk)) d.catMemory[`voice:${mk}`] = t.categoryId;
  return t;
}

/** For the screen: the draft as label/value rows. */
export function draftRows(d: FinanceData, today: Iso, n: Draft): { key: Ask; label: string; value: string | null }[] {
  return [
    { key: 'amount', label: 'مبلغ', value: n.amountRial ? `${(n.amountRial / 10).toLocaleString('fa-IR')} تومان` : null },
    { key: 'kind', label: 'نوع', value: n.kind ? KIND_LABEL[n.kind] : null },
    { key: 'account', label: n.kind === 'transfer' ? 'از حساب' : 'حساب', value: n.accountId ? accName(d, n.accountId) : null },
    n.kind === 'transfer'
      ? { key: 'toAccount', label: 'به حساب', value: n.toAccountId ? accName(d, n.toAccountId) : null }
      : { key: 'category', label: 'دسته', value: n.categoryId ? catName(d, n.categoryId) : null },
    { key: 'date', label: 'تاریخ', value: dateWords(n.date, today) },
    ...(n.note ? [{ key: 'open' as Ask, label: 'بابت', value: n.note }] : []),
  ];
}
