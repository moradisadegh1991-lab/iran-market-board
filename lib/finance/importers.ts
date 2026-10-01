// ورود تراکنش از گردش حساب (اکسل/CSV/PDF) و پیامک بانکی — pure functions, no I/O.
//
// Reading the FILE (SheetJS / pdf.js) happens in the browser, in components/finance/views/
// ImportView.tsx; this module only turns the resulting cells or text items into staged
// transactions. Nothing here is ever sent to the server (CLAUDE.md rule 7).
//
// Two rules carried over from the rest of the app:
//  • rule 1 — amounts are explicit: statements are rial unless the header says toman, and the
//    caller can override; everything is stored in rial.
//  • rule 3 — direction is never guessed. It comes from a debit/credit column, a sign, the change
//    in the running balance, or an explicit verb in the SMS. When those disagree or are absent,
//    `direction` is null and the user decides.
import { isoToJalali, jalaliMonthLength, jalaliToIso } from '@/lib/jalali';
import { newId, type FinanceData, type Iso, type Staged } from './model';

// ── text helpers ───────────────────────────────────────────────────────────

/** Persian/Arabic digits → ASCII, ي/ك → ی/ک, bidi marks and ZWNJ-like noise removed. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC') // Arabic presentation forms (ﺎ ﺟ, common in PDFs) → base letters
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[٬]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A money cell → number (or null). Accepts "1,250,000", "1250000", "(1,250,000)", "-1,250,000",
 * "1,250,000-" and "1٬250٬000". Returns the sign separately so a signed amount column works.
 */
export function parseMoney(cell: unknown): { value: number; negative: boolean } | null {
  const s = norm(cell).replace(/ریال|تومان|rial|irr/gi, '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /^−/.test(s);
  const digits = s.replace(/[(),\s−-]/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? { value, negative } : null;
}

/**
 * Jalali or Gregorian date text → ISO. Accepts 1405/06/20, 05/06/20, 1405-6-20, 14050620 and
 * 2026-09-11. Returns null for anything that is not a real calendar day.
 */
export function parseDate(cell: unknown): Iso | null {
  const s = norm(cell);
  let m = /(\d{2,4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /\b(1[34]\d{2})(\d{2})(\d{2})\b/.exec(s))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else return null;
  if (y >= 1900) {
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).getUTCDate() === d ? iso : null;
  }
  if (y < 100) y += y >= 70 ? 1300 : 1400; // two-digit Jalali years: 05 → 1405, 99 → 1399
  if (y < 1300 || y > 1500 || mo < 1 || mo > 12 || d < 1 || d > jalaliMonthLength(y, mo)) return null;
  return jalaliToIso(y, mo, d);
}

const timeOf = (s: string) => /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/.exec(norm(s))?.[0] ?? null;

/** Stable id, so importing the same file twice does not queue the same rows twice. */
function stableId(parts: (string | number | null | undefined)[]): string {
  let h = 2166136261;
  for (const ch of parts.map((p) => String(p ?? '')).join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `imp-${(h >>> 0).toString(36)}`;
}

/** The part of a description that identifies the counterparty, for remembering categories. */
export function memoryKey(description: string): string {
  return norm(description)
    .replace(/\d[\d,./:-]*/g, ' ')
    .replace(/[^\p{L} ]/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 4)
    .join(' ');
}

// ── statement tables (Excel / CSV / reconstructed PDF) ─────────────────────

type Role = 'date' | 'time' | 'desc' | 'out' | 'in' | 'amount' | 'balance' | 'ref';

/** Header words of Iranian internet-bank exports. Order matters: "مبلغ برداشت" must be `out`, not `amount`. */
const HEADER_RULES: [Role, RegExp][] = [
  ['out', /برداشت|بدهکار|بدهی|debit|withdraw/i],
  ['in', /واریز|بستانکار|credit|deposit/i],
  ['balance', /مانده|موجودی|balance/i],
  ['date', /تاریخ|date/i],
  ['time', /زمان|ساعت|time/i],
  ['ref', /پیگیری|سند|مرجع|ارجاع|شماره تراکنش|reference|ref/i],
  ['desc', /شرح|توضیح|بابت|عنوان|نوع تراکنش|شعبه|description|narration/i],
  ['amount', /مبلغ|amount/i],
];

export interface ColumnMap {
  headerRow: number;
  cols: Partial<Record<Role, number>>;
  unit: 'rial' | 'toman';
  unitFromHeader: boolean;
}

function roleOf(cell: string): Role | null {
  const c = norm(cell);
  if (!c || c.length > 40) return null;
  for (const [role, rx] of HEADER_RULES) if (rx.test(c)) return role;
  return null;
}

/** Finds the header row (the first row naming a date and some money column) and maps its columns. */
export function detectColumns(table: string[][]): ColumnMap | null {
  for (let r = 0; r < Math.min(table.length, 40); r++) {
    const cols: Partial<Record<Role, number>> = {};
    table[r].forEach((cell, i) => {
      const role = roleOf(cell);
      if (role && cols[role] === undefined) cols[role] = i;
    });
    const hasMoney = cols.out !== undefined || cols.in !== undefined || cols.amount !== undefined;
    if (cols.date !== undefined && hasMoney) {
      const headerText = table.slice(Math.max(0, r - 3), r + 1).flat().map(norm).join(' ');
      const toman = /تومان/.test(headerText) && !/ریال/.test(headerText);
      return { headerRow: r, cols, unit: toman ? 'toman' : 'rial', unitFromHeader: /تومان|ریال/.test(headerText) };
    }
  }
  return null;
}

export interface StatementResult {
  rows: Staged[];
  map: ColumnMap | null;
  skipped: number;
  warnings: string[];
}

/**
 * Turns a statement table into staged transactions.
 *
 * Direction, in order of trust: the running balance (a change of exactly ±amount between two
 * consecutive rows is the bank's own arithmetic), then separate debit/credit columns, then a sign
 * on a single amount column. When the balance contradicts the column, the row is left undecided
 * — that is either an unusual layout or a misread, and the user should look.
 */
export function rowsFromTable(table: string[][], opts: { accountId?: string | null; unit?: 'rial' | 'toman'; now?: number } = {}): StatementResult {
  const warnings: string[] = [];
  const map = detectColumns(table);
  if (!map) return { rows: [], map: null, skipped: 0, warnings: ['سرستون جدول پیدا نشد؛ ستون‌های «تاریخ» و «مبلغ/برداشت/واریز» باید در فایل باشند.'] };
  const unit = opts.unit ?? map.unit;
  const k = unit === 'toman' ? 10 : 1;
  const c = map.cols;
  const cell = (row: string[], role: Role) => (c[role] === undefined ? '' : row[c[role]!] ?? '');

  interface Pre { date: Iso; time: string | null; amount: number; colDir: 'out' | 'in' | null; balance: number | null; desc: string; ref: string | null; raw: string }
  const pre: Pre[] = [];
  let skipped = 0;
  const body = table.slice(map.headerRow + 1);
  // one signed amount column: when some amounts carry a minus, an unsigned one is a credit
  const signedColumn = c.amount !== undefined && c.out === undefined && c.in === undefined && body.some((r) => parseMoney(r[c.amount!])?.negative);
  let opening: number | null = null;
  for (const row of body) {
    const text = row.map(norm).join(' ');
    const date = parseDate(cell(row, 'date'));
    if (/مانده (از )?(قبل|اول)|موجودی (اول|ابتدای) دوره/.test(text)) {
      const b = parseMoney(cell(row, 'balance'));
      if (b) opening = (b.negative ? -b.value : b.value) * k;
    }
    if (!date || /جمع|مجموع|total|مانده (از )?(قبل|اول)|موجودی (اول|ابتدای) دوره|انتقال از صفحه/i.test(text)) {
      if (row.some((x) => norm(x))) skipped++;
      continue;
    }
    const out = parseMoney(cell(row, 'out'));
    const inn = parseMoney(cell(row, 'in'));
    const amt = parseMoney(cell(row, 'amount'));
    let amount = 0;
    let colDir: 'out' | 'in' | null = null;
    if (out && out.value > 0 && !(inn && inn.value > 0)) [amount, colDir] = [out.value, 'out'];
    else if (inn && inn.value > 0 && !(out && out.value > 0)) [amount, colDir] = [inn.value, 'in'];
    else if (amt && amt.value > 0) [amount, colDir] = [amt.value, amt.negative ? 'out' : signedColumn || /^\+/.test(norm(cell(row, 'amount'))) ? 'in' : null];
    if (!(amount > 0)) {
      skipped++;
      continue;
    }
    const bal = parseMoney(cell(row, 'balance'));
    pre.push({
      date,
      time: timeOf(cell(row, 'time')) ?? timeOf(cell(row, 'date')),
      amount: amount * k,
      colDir,
      balance: bal ? (bal.negative ? -bal.value : bal.value) * k : null,
      desc: norm(cell(row, 'desc')) || norm(row.filter((_, i) => !Object.values(c).includes(i)).join(' ')),
      ref: norm(cell(row, 'ref')) || null,
      raw: row.map(norm).filter(Boolean).join(' | '),
    });
  }

  // The balance walk needs chronological order. Exports are often newest-first, and rows of the
  // same day give no date to tell by, so take whichever order the bank's own arithmetic agrees with.
  const walk = (list: Pre[]) => list.map((p, i) => {
    const prev = i > 0 ? list[i - 1].balance : null;
    if (p.balance === null || prev === null) return null;
    const delta = p.balance - prev;
    return Math.abs(Math.abs(delta) - p.amount) <= Math.max(1, p.amount * 1e-6) ? (delta < 0 ? ('out' as const) : ('in' as const)) : null;
  });
  const fwd = walk(pre);
  const rev = walk([...pre].reverse());
  const hits = (a: (string | null)[]) => a.filter(Boolean).length;
  const reversed = hits(rev) > hits(fwd) || (hits(rev) === hits(fwd) && pre.length > 1 && pre[0].date > pre[pre.length - 1].date);
  const chron = reversed ? [...pre].reverse() : pre;
  const balDir = reversed ? rev : fwd;
  // the oldest row has no predecessor, unless the file states the opening balance
  if (opening !== null && chron.length && chron[0].balance !== null) {
    const delta = chron[0].balance - opening;
    if (Math.abs(Math.abs(delta) - chron[0].amount) <= Math.max(1, chron[0].amount * 1e-6)) balDir[0] = delta < 0 ? 'out' : 'in';
  }

  let conflicts = 0, undecided = 0;
  const now = opts.now ?? Date.now();
  const rows: Staged[] = chron.map((p, i) => {
    let direction: Staged['direction'] = null;
    let why = '';
    if (balDir[i] && p.colDir && balDir[i] !== p.colDir) {
      conflicts++;
      why = 'ستون مبلغ و تغییر مانده با هم نمی‌خوانند — خودتان بررسی کنید';
    } else if (balDir[i]) {
      direction = balDir[i];
      why = p.colDir ? 'ستون جدول و تغییر مانده هر دو' : 'تغییر مانده حساب';
    } else if (p.colDir) {
      direction = p.colDir;
      why = c.out !== undefined || c.in !== undefined ? 'ستون برداشت/واریز' : 'علامت مبلغ';
    } else {
      undecided++;
      why = 'فایل جهت این ردیف را مشخص نکرده است';
    }
    return {
      id: stableId(['st', opts.accountId, p.date, p.time, p.amount, p.balance, p.ref, p.desc]),
      source: 'statement',
      date: p.date,
      time: p.time,
      amountRial: Math.round(p.amount),
      direction,
      why,
      balanceRial: p.balance,
      description: p.desc,
      ref: p.ref,
      fee: /کارمزد/.test(p.desc),
      raw: p.raw,
      accountId: opts.accountId ?? null,
      importedAt: now,
    };
  });
  if (conflicts) warnings.push(`${conflicts.toLocaleString('fa-IR')} ردیف با مانده حساب جور نبود و بدون جهت ماند.`);
  if (undecided) warnings.push(`${undecided.toLocaleString('fa-IR')} ردیف جهت مشخص نداشت؛ نوعشان را خودتان تعیین کنید.`);
  if (!map.unitFromHeader && !opts.unit) warnings.push('واحد مبالغ در فایل نوشته نشده بود؛ ریال فرض شد. اگر تومان است، واحد را عوض کنید.');
  return { rows, map, skipped, warnings };
}

/** CSV text → cells (quotes, commas or semicolons/tabs as separators). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((x) => x.replace(/^﻿/, '')));
}

// ── PDF: positioned text → table ───────────────────────────────────────────

export interface PdfItem {
  str: string;
  x: number; // left edge
  y: number; // baseline, page coordinates (larger = higher on the page)
  w: number;
}

/**
 * Rebuilds a table from pdf.js text items. A PDF has no cells, only words at positions, and a
 * row with an empty debit cell has fewer words than one with both — so rows cannot be split by
 * word count. Instead every word is assigned to the column whose HEADER it sits under, using the
 * header's horizontal span. A line with neither a date nor an amount is a wrapped description;
 * it belongs to the dated line nearest to it vertically — above or below, since report tools
 * often centre the other cells of a tall row.
 */
export function tableFromPdf(pages: PdfItem[][]): string[][] {
  const out: string[][] = [];
  let header: { role: Role | null; label: string; x0: number; x1: number }[] | null = null;
  for (const items of pages) {
    const body: { y: number; row: string[]; anchor: boolean; wrap: boolean }[] = [];
    for (const line of groupLines(items)) {
      const cells = mergeCells(line);
      const roles = cells.map((c) => roleOf(c.str));
      const isHeader = roles.includes('date') && roles.some((r) => r === 'out' || r === 'in' || r === 'amount');
      if (isHeader) {
        const first = !header;
        header = cells.map((c, i) => ({ role: roles[i], label: c.str, x0: c.x, x1: c.x + c.w }));
        if (first) out.push(header.map((h) => h.label)); // repeated headers on later pages are not rows
        continue;
      }
      if (!header) {
        out.push(cells.map((c) => c.str)); // title lines before the table; detectColumns skips them
        continue;
      }
      const row = header.map(() => '');
      for (const c of cells) {
        const mid = c.x + c.w / 2;
        let best = 0, bestD = Infinity;
        header.forEach((h, i) => {
          const d = mid >= h.x0 - 4 && mid <= h.x1 + 4 ? 0 : Math.min(Math.abs(mid - h.x0), Math.abs(mid - h.x1));
          if (d < bestD) { bestD = d; best = i; }
        });
        row[best] = row[best] ? `${row[best]} ${c.str}` : c.str;
      }
      const dateCol = header.findIndex((h) => h.role === 'date');
      const anchor = dateCol >= 0 && !!parseDate(row[dateCol]);
      const wrap = !anchor && !row.some((v) => parseMoney(v));
      body.push({ y: line[0].y, row, anchor, wrap });
    }
    if (!header) continue;
    const descCol = header.findIndex((h) => h.role === 'desc');
    const anchors = body.filter((b) => b.anchor);
    // wrapped text above a row is prepended, below it appended, so the description reads in order
    const before = new Map<(typeof body)[number], string[]>();
    const after = new Map<(typeof body)[number], string[]>();
    // a wrapped line sits inside its row; text further away (a footer note) is not part of any row
    const gaps = anchors.slice(1).map((a, i) => Math.abs(anchors[i].y - a.y)).sort((x, y) => x - y);
    const reach = gaps.length ? gaps[Math.floor(gaps.length / 2)] * 0.75 : 14;
    for (const b of body) {
      if (!b.wrap || descCol < 0 || !anchors.length) continue;
      const near = anchors.reduce((p, a) => (Math.abs(a.y - b.y) < Math.abs(p.y - b.y) ? a : p));
      if (Math.abs(near.y - b.y) > reach) {
        b.wrap = false; // kept as its own line; rowsFromTable skips it (no date)
        continue;
      }
      const text = b.row.filter(Boolean).join(' ');
      const m = b.y > near.y ? before : after;
      m.set(near, [...(m.get(near) ?? []), text]);
    }
    for (const b of body) {
      if (b.wrap && descCol >= 0 && anchors.length) continue;
      if (descCol >= 0 && (before.has(b) || after.has(b)))
        b.row[descCol] = [...(before.get(b) ?? []), b.row[descCol], ...(after.get(b) ?? [])].filter(Boolean).join(' ');
      out.push(b.row);
    }
  }
  return out;
}

function groupLines(items: PdfItem[]): PdfItem[][] {
  const sorted = items.filter((i) => norm(i.str)).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= 3);
    if (line) line.push(it);
    else lines.push([it]);
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x));
}

const RTL_LETTER = /[\u0621-\u064A\u0671-\u06D3\u06FA-\u06FF]/;
const LTR_STRONG = /[0-9A-Za-z\u06F0-\u06F9\u0660-\u0669]/;

/**
 * Visual ↔ logical order for one RTL line (the operation is its own inverse): runs of numbers or
 * Latin keep their order, everything else is mirrored. Neutral marks between two digits ("1,250",
 * "1405/07/01", "14:35") stay with the number.
 */
export function flipRtl(text: string): string {
  const ch = [...text];
  const ltr = ch.map((c) => LTR_STRONG.test(c));
  // neutrals (not RTL letters) sandwiched between LTR characters join the LTR run
  for (let i = 0; i < ch.length; i++) {
    if (ltr[i] || RTL_LETTER.test(ch[i]) || /\s/.test(ch[i])) continue;
    let l = i - 1, r = i + 1;
    while (r < ch.length && !ltr[r] && !RTL_LETTER.test(ch[r]) && !/\s/.test(ch[r])) r++;
    if (l >= 0 && ltr[l] && r < ch.length && ltr[r]) for (let k = i; k < r; k++) ltr[k] = true;
    i = r - 1;
  }
  const runs: { ltr: boolean; s: string }[] = [];
  ch.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr[i]) last.s += c;
    else runs.push({ ltr: ltr[i], s: c });
  });
  return runs
    .reverse()
    .map((r) => (r.ltr ? r.s : [...r.s].reverse().join('')))
    .join('');
}

/**
 * Words close together on a line are one cell ("مبلغ" + "برداشت", "1,250" + ",000"). pdf.js may
 * return Persian as single glyphs in VISUAL order (left to right on the page) and as presentation
 * forms, or as whole words in logical order; both are rebuilt into logical text here.
 */
function mergeCells(line: PdfItem[]): PdfItem[] {
  const groups: PdfItem[][] = [];
  for (const it of line) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && it.x - (prev.x + prev.w) < 6) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => {
    let visual = '';
    g.forEach((it, i) => {
      const t = it.str.normalize('NFKC');
      const gap = i ? it.x - (g[i - 1].x + g[i - 1].w) : 0;
      if (i && gap > 1.5 && !visual.endsWith(' ')) visual += ' ';
      // a multi-letter Persian item is already in logical order: turn it back to visual first
      visual += RTL_LETTER.test(t) ? flipRtl(t) : t;
    });
    const str = norm(RTL_LETTER.test(visual) ? flipRtl(visual) : visual);
    const last = g[g.length - 1];
    return { str, x: g[0].x, y: g[0].y, w: last.x + last.w - g[0].x };
  });
}

// ── SMS ────────────────────────────────────────────────────────────────────

/** Shape of android-app/www/sms-parser.js, which is reused here so both apps read SMS the same way. */
export interface SmsApi {
  classify(body: string): { kind: 'confirmed'; tx: SmsTx } | { kind: 'ambiguous'; guessedAmount: number | null; guessedWithdrawal: boolean } | { kind: 'not' };
}
interface SmsTx {
  amount: number;
  isWithdrawal: boolean;
  directionClear?: boolean;
  cardLast4: string | null;
  balance: number | null;
  channel: string | null;
  accountNo: string | null;
  isFee?: boolean;
}

/** Splits a paste of several SMS: blank lines, or a new bank header line, start a new message. */
export function splitSms(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n|\n(?=-{3,})/)
    .map((s) => s.replace(/^-{3,}\s*/, '').trim())
    .filter((s) => s.length > 8);
}

/** Date written inside the SMS (1405/06/20, 05/06/20, or "0620-14:35" as several banks send). */
export function smsDate(body: string, today: Iso): Iso | null {
  const n = norm(body);
  const full = parseDate(n);
  if (full) return full;
  const m = /\b(\d{2})(\d{2})-([01]?\d|2[0-3]):[0-5]\d\b/.exec(n); // MMDD-HH:MM
  if (m) {
    const ty = isoToJalali(today).jy;
    const mo = +m[1], d = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= jalaliMonthLength(ty, mo)) {
      const iso = jalaliToIso(ty, mo, d);
      return iso > today ? jalaliToIso(ty - 1, mo, Math.min(d, jalaliMonthLength(ty - 1, mo))) : iso;
    }
  }
  return null;
}

export interface SmsResult {
  rows: Staged[];
  ignored: { text: string; reason: string }[];
}

/**
 * Reads pasted SMS with the same parser the Android app uses. A message whose verb is clear gets a
 * direction; a message with both or neither verb — or one the parser could only half-read —
 * is queued with direction null for the user to decide (rule 3: never default to "deposit").
 */
export function rowsFromSms(text: string, api: SmsApi, today: Iso, opts: { accountId?: string | null; now?: number } = {}): SmsResult {
  return rowsFromMessages(splitSms(text).map((body) => ({ body })), api, today, opts);
}

/** One SMS as the phone's inbox gives it: `at` is the receive time (ms), when known. */
export interface SmsMessage {
  body: string;
  at?: number;
}

const tehranIso = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const tehranTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/**
 * Pasted text and the Android inbox go through the same path. A date written in the SMS wins;
 * otherwise the inbox receive time is used (the bank sends within seconds of the transaction).
 */
export function rowsFromMessages(msgs: SmsMessage[], api: SmsApi, today: Iso, opts: { accountId?: string | null; now?: number } = {}): SmsResult {
  const rows: Staged[] = [];
  const ignored: SmsResult['ignored'] = [];
  for (const { body: rawBody, at } of msgs) {
    const body = rawBody.trim();
    if (body.length <= 8) continue;
    const c = api.classify(body);
    const date = smsDate(body, today) ?? (at ? tehranIso(at) : null);
    // banks write rial; a message that says only «تومان» is converted (rule 1)
    const k = /تومان/.test(body) && !/ریال|ريال/.test(body) ? 10 : 1;
    const base = { source: 'sms' as const, date, time: timeOf(body) ?? (at ? tehranTime(at) : null), raw: body, accountId: opts.accountId ?? null, importedAt: opts.now ?? Date.now() };
    if (c.kind === 'not') {
      ignored.push({ text: body, reason: 'پیام بانکی تراکنش نبود (رمز یک‌بار مصرف، تبلیغ یا پیام اپراتور)' });
      continue;
    }
    if (c.kind === 'ambiguous') {
      if (!c.guessedAmount) {
        ignored.push({ text: body, reason: 'مبلغی در پیامک پیدا نشد' });
        continue;
      }
      rows.push({ ...base, id: stableId(['sms', body, at ?? '']), amountRial: c.guessedAmount * k, direction: null, uncertainAmount: true, why: 'پیامک به‌طور کامل خوانده نشد؛ مبلغ و جهت را بررسی کنید', description: norm(body).slice(0, 80), balanceRial: null, card: null });
      continue;
    }
    const t = c.tx;
    const clear = t.directionClear !== false;
    rows.push({
      ...base,
      id: stableId(['sms', body, at ?? '']),
      amountRial: t.amount * k,
      direction: clear ? (t.isWithdrawal ? 'out' : 'in') : null,
      why: clear
        ? t.isWithdrawal ? 'فعل برداشت/خرید در پیامک' : 'فعل واریز در پیامک'
        : /برداشت|خرید|کسر|پرداخت|انتقال از/.test(norm(body)) && /واریز|افزایش|انتقال به حساب شما/.test(norm(body))
          ? 'پیامک هم واژه برداشت دارد هم واریز'
          : 'پیامک نگفته برداشت است یا واریز',
      balanceRial: t.balance === null ? null : t.balance * k,
      description: [t.channel, t.cardLast4 ? `کارت ${t.cardLast4}` : null, t.accountNo ? `حساب ${t.accountNo}` : null].filter(Boolean).join(' · ') || norm(body).slice(0, 80),
      card: t.cardLast4,
      fee: !!t.isFee,
    });
  }
  return { rows, ignored };
}

// ── shared: duplicates, category suggestion, queueing ──────────────────────

/** An already-recorded transaction with the same day, amount and direction (and ref, if both have one). */
export function isDuplicate(d: FinanceData, s: Staged): boolean {
  if (!s.date || !s.direction) return false;
  return d.txns.some(
    (t) =>
      t.date === s.date &&
      t.amountRial === s.amountRial &&
      (t.kind === 'transfer' || (t.kind === 'expense') === (s.direction === 'out')) &&
      (!t.ref || !s.ref || t.ref === s.ref),
  );
}

const CAT_HINTS: [RegExp, string, 'out' | 'in' | null][] = [
  [/حقوق|مزایا|پاداش|salary/, 'i-salary', 'in'],
  [/سود (سپرده|حساب|سهام)|سود\b/, 'i-invest', 'in'],
  [/قبض|برق|گاز|آب\b|آبفا|تلفن|مخابرات|اینترنت|شارژ (ساختمان|خانه)/, 'c-bills', 'out'],
  [/قسط|اقساط|وام|تسهیلات/, 'c-loan', 'out'],
  [/اجاره|رهن/, 'c-home', 'out'],
  [/بنزین|سوخت|تاکسی|اسنپ|تپسی|مترو|پارکینگ/, 'c-transport', 'out'],
  [/داروخانه|بیمارستان|درمانگاه|پزشک|آزمایشگاه/, 'c-health', 'out'],
  [/سوپرمارکت|هایپر|فروشگاه|رستوران|نانوایی|میوه|اسنپ ?فود/, 'c-food', 'out'],
  [/شهریه|مدرسه|دانشگاه|آموزش/, 'c-edu', 'out'],
  [/کارمزد/, 'c-other', 'out'],
];

/** Suggests a category: the user's own earlier choice for the same description first, then keywords. */
export function suggestCategory(d: FinanceData, s: Staged): string | null {
  if (s.categoryId && d.categories.some((c) => c.id === s.categoryId)) return s.categoryId;
  const mem = d.catMemory[memoryKey(s.description)];
  if (mem && d.categories.some((c) => c.id === mem)) return mem;
  const text = norm(`${s.description} ${s.raw}`);
  for (const [rx, cat, dir] of CAT_HINTS) if (rx.test(text) && (!dir || !s.direction || dir === s.direction) && d.categories.some((c) => c.id === cat)) return cat;
  return null;
}

/** Adds new rows to the inbox, skipping ids already queued. Returns how many were new. */
export function enqueue(d: FinanceData, rows: Staged[]): number {
  const have = new Set(d.inbox.map((x) => x.id));
  const fresh = rows.filter((r) => !have.has(r.id));
  d.inbox.push(...fresh);
  return fresh.length;
}

// ── confirming a staged row ────────────────────────────────────────────────

export type StagedChoice = 'expense' | 'income' | 'transfer-out' | 'transfer-in';
export const CHOICE_LABEL: Record<StagedChoice, string> = {
  expense: 'هزینه',
  income: 'درآمد',
  'transfer-out': 'انتقال به حساب دیگرم',
  'transfer-in': 'انتقال از حساب دیگرم',
};

/** What the queue pre-selects: the source's own direction, as a transfer when the source said so. */
export function defaultChoice(s: Staged): StagedChoice | undefined {
  if (s.direction === 'out') return s.transfer ? 'transfer-out' : 'expense';
  if (s.direction === 'in') return s.transfer ? 'transfer-in' : 'income';
  return undefined;
}

/** The choices that agree with what the source said; all four when it said nothing. */
export function choicesFor(s: Staged): StagedChoice[] {
  if (s.direction === 'out') return ['expense', 'transfer-out'];
  if (s.direction === 'in') return ['income', 'transfer-in'];
  return ['expense', 'income', 'transfer-out', 'transfer-in'];
}

export interface CommitInput {
  choice: StagedChoice;
  accountId: string;
  /** transfers: the user's other account */
  otherAccountId?: string | null;
  categoryId?: string | null;
  /** required when the staged row has no date */
  date?: Iso | null;
  /** a corrected amount, for rows the parser only half-read */
  amountRial?: number | null;
}

/**
 * Records one staged row as a transaction and removes it from the inbox. Returns an error message
 * (and changes nothing) when the input is incomplete or contradicts the source: a row the bank
 * marked as a withdrawal cannot be booked as income.
 */
export function commitStaged(d: FinanceData, id: string, inp: CommitInput): string | null {
  const s = d.inbox.find((x) => x.id === id);
  if (!s) return 'این ردیف دیگر در صف نیست.';
  if (!choicesFor(s).includes(inp.choice)) return 'نوع انتخاب‌شده با جهت ثبت‌شده در بانک نمی‌خواند.';
  const date = inp.date || s.date;
  if (!date) return 'تاریخ این تراکنش را انتخاب کنید.';
  if (!d.accounts.some((a) => a.id === inp.accountId)) return 'حساب را انتخاب کنید.';
  const amountRial = inp.amountRial ?? s.amountRial;
  if (!(Number.isFinite(amountRial) && amountRial > 0)) return 'مبلغ نامعتبر است.';
  const transfer = inp.choice === 'transfer-out' || inp.choice === 'transfer-in';
  if (transfer && (!inp.otherAccountId || inp.otherAccountId === inp.accountId || !d.accounts.some((a) => a.id === inp.otherAccountId)))
    return 'برای انتقال، حساب دیگر را انتخاب کنید.';
  const kind: 'expense' | 'income' | 'transfer' = inp.choice === 'expense' || inp.choice === 'income' ? inp.choice : 'transfer';
  const cat = !transfer && inp.categoryId && d.categories.some((c) => c.id === inp.categoryId && c.kind === kind) ? inp.categoryId : null;
  d.txns.push({
    id: newId('t'),
    date,
    kind,
    amountRial: Math.round(amountRial),
    accountId: inp.choice === 'transfer-in' ? inp.otherAccountId! : inp.accountId,
    toAccountId: transfer ? (inp.choice === 'transfer-in' ? inp.accountId : inp.otherAccountId!) : null,
    categoryId: cat,
    note: s.description.slice(0, 120),
    src: s.source,
    ref: s.ref ?? null,
  });
  const key = memoryKey(s.description);
  if (cat && key) d.catMemory[key] = cat;
  d.inbox = d.inbox.filter((x) => x.id !== id);
  return null;
}

/** Drops staged rows without recording them (already entered by hand, a duplicate, not mine…). */
export function dismissStaged(d: FinanceData, ids: string[]): void {
  const drop = new Set(ids);
  d.inbox = d.inbox.filter((x) => !drop.has(x.id));
}
