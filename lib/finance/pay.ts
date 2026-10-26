// شارژ، بسته اینترنت و پرداخت قبض (rule 106) — the pure half.
//
// No contract with a payment intermediary (the user's choice): the app prepares the request — the operator from the
// number's prefix, the bill's service and amount from its own IDs, checked — and the user pays where they already pay
// (a bank's USSD code such as *780#, or their payment app). When they say it is done, ONE expense named after the request
// is booked; if the bank's SMS of that payment is already booked or waiting in the queue, the request becomes that
// transaction instead of a second one (the pattern of rules 88 and 100), and a bill the user tracks is marked paid for the
// month. Nothing here goes to any server (rule 7). Never guessed: the operator from a prefix is a suggestion the user can
// change (numbers move between operators), and a tracked bill is linked only when the user picks it.
import { addDays, monthKey, monthOf } from './calc';
import { commitStaged } from './importers';
import { newId, type Bill, type FinanceData, type Iso, type PayRequest, type Staged, type Txn } from './model';

export type Operator = 'mci' | 'irancell' | 'rightel';
export const OPERATOR_FA: Record<Operator, string> = { mci: 'همراه اول', irancell: 'ایرانسل', rightel: 'رایتل' };

/** prefixes whose operator is certain enough to suggest; anything else is asked */
const PREFIX: Record<string, Operator> = {};
for (const p of ['0910', '0911', '0912', '0913', '0914', '0915', '0916', '0917', '0918', '0919', '0990', '0991', '0992', '0993', '0994']) PREFIX[p] = 'mci';
for (const p of ['0930', '0933', '0935', '0936', '0937', '0938', '0939', '0900', '0901', '0902', '0903', '0904', '0905', '0941']) PREFIX[p] = 'irancell';
for (const p of ['0920', '0921', '0922']) PREFIX[p] = 'rightel';

const digitsOf = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[^\d+]/g, '');

/** «۰۹۱۲ ۳۴۵ ۶۷۸۹»، «+989123456789»، «9123456789» → «09123456789»; anything else null */
export function normalizeMobile(s: string): string | null {
  let d = digitsOf(s).replace(/^\+/, '');
  if (d.startsWith('0098')) d = '0' + d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}

/** the operator the prefix suggests (null = unknown: the user picks) */
export const operatorOf = (mobile: string): Operator | null => PREFIX[mobile.slice(0, 4)] ?? null;

/**
 * «0912…6789»: enough to recognise, not the whole number, in a transaction's note — inside a left-to-right isolate, or the
 * Persian line around it shows «6789…0912»
 */
export const maskMobile = (m: string) => `\u2066${m.slice(0, 4)}…${m.slice(-4)}\u2069`;

// ── bills (the algorithm of persian-tools' Bill, MIT) ────────────────────────
export const BILL_TYPE_FA: Record<number, string> = { 1: 'آب', 2: 'برق', 3: 'گاز', 4: 'تلفن ثابت', 5: 'تلفن همراه', 6: 'عوارض شهرداری', 8: 'سازمان مالیات', 9: 'جرایم راهنمایی و رانندگی' };

/** the control digit: weights 2…7 from the right, mod 11, 0 or 1 → 0 */
export function checkDigit(num: string): number {
  let sum = 0;
  let w = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    if (w === 8) w = 2;
    sum += Number(num[i]) * w;
    w++;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export interface BillCheck {
  billId: string;
  paymentId: string;
  type: number | null;
  typeFa: string | null;
  /** from the payment ID: everything before its last 5 digits × 1000 rial */
  amountRial: number | null;
  validBillId: boolean;
  validPayment: boolean;
  errors: string[];
}

/** Checks a bill's two IDs and reads its service and amount from them. */
export function checkBill(billIdIn: string, paymentIdIn: string): BillCheck {
  const billId = digitsOf(billIdIn).replace(/^0+/, '');
  const paymentId = digitsOf(paymentIdIn).replace(/^0+/, '');
  const errors: string[] = [];
  const type = billId.length >= 6 ? Number(billId.slice(-2, -1)) : null;
  const typeFa = type !== null ? (BILL_TYPE_FA[type] ?? null) : null;
  const validBillId = billId.length >= 6 && billId.length <= 13 && checkDigit(billId.slice(0, -1)) === Number(billId.slice(-1)) && typeFa !== null;
  if (!validBillId) errors.push('شناسه قبض درست نیست — دوباره از روی قبض بخوانید.');
  let validPayment = false;
  let amountRial: number | null = null;
  if (paymentId.length >= 6 && paymentId.length <= 13) {
    const body = paymentId.slice(0, -2);
    const c1 = Number(paymentId.slice(-2, -1));
    const c2 = Number(paymentId.slice(-1));
    validPayment = checkDigit(body) === c1 && checkDigit(billId + body + c1) === c2;
    const amt = Number(paymentId.slice(0, -5));
    amountRial = Number.isFinite(amt) && amt > 0 ? amt * 1000 : null;
  }
  if (!validPayment) errors.push(validBillId ? 'شناسه پرداخت با این شناسه قبض نمی‌خواند — هر دو را دوباره بخوانید.' : 'شناسه پرداخت درست نیست.');
  if (validPayment && !amountRial) errors.push('مبلغ این قبض صفر است (شاید پرداخت شده).');
  return { billId, paymentId, type, typeFa, amountRial, validBillId, validPayment, errors };
}

/**
 * The two IDs from a pasted text: a bill SMS («شناسه قبض: … شناسه پرداخت: …») or a barcode (13 digits of the bill ID,
 * 3 zeros, then the payment ID). null when neither is there.
 */
export function billFromText(text: string): { billId: string; paymentId: string } | null {
  const t = text.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const b = /شناسه\s*(?:ی\s*)?قبض\s*[:：]?\s*(\d{6,13})/.exec(t);
  const p = /شناسه\s*(?:ی\s*)?پرداخت\s*[:：]?\s*(\d{6,13})/.exec(t);
  if (b && p) return { billId: b[1], paymentId: p[1] };
  const bar = /(?:^|\D)(\d{26})(?:\D|$)/.exec(t);
  if (bar) return { billId: bar[1].slice(0, 13).replace(/^0+/, ''), paymentId: bar[1].slice(16).replace(/^0+/, '') };
  return null;
}

// ── requests ─────────────────────────────────────────────────────────────────
export interface RequestInput {
  kind: PayRequest['kind'];
  mobile?: string;
  operator?: Operator | null;
  label?: string;
  amountRial?: number;
  billId?: string;
  paymentId?: string;
}

/** Makes a request from what the form has; an error message when something is missing or wrong. */
export function makeRequest(inp: RequestInput, now = Date.now()): PayRequest | string {
  if (inp.kind === 'bill') {
    const c = checkBill(inp.billId ?? '', inp.paymentId ?? '');
    if (c.errors.length) return c.errors[0];
    return { id: newId('pr'), kind: 'bill', billId: c.billId, paymentId: c.paymentId, billType: c.type, amountRial: c.amountRial!, createdAt: now, status: 'pending' };
  }
  const mobile = normalizeMobile(inp.mobile ?? '');
  if (!mobile) return 'شماره موبایل را درست بنویسید (۱۱ رقم، با ۰۹).';
  const operator = inp.operator ?? operatorOf(mobile);
  if (!operator) return 'اپراتور این خط کدام است؟';
  const amountRial = Math.round(inp.amountRial ?? 0);
  if (!(amountRial > 0)) return 'مبلغ را بنویسید.';
  const label = inp.label?.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (inp.kind === 'package' && !label) return 'کدام بسته؟ (مثلاً «۳۰ روزه ۲۰ گیگ»)';
  return { id: newId('pr'), kind: inp.kind, mobile, operator, label: label || undefined, amountRial, createdAt: now, status: 'pending' };
}

/** the transaction's name: «شارژ ایرانسل 0935…1234»، «بسته اینترنت همراه اول ۳۰ روزه ۲۰ گیگ (0912…6789)»، «قبض برق — شناسه 123…» */
export function requestTitle(r: PayRequest): string {
  if (r.kind === 'bill') return `قبض ${BILL_TYPE_FA[r.billType ?? -1] ?? ''} — شناسه ${r.billId}`.replace(/\s+/g, ' ');
  const op = r.operator ? OPERATOR_FA[r.operator] : '';
  const who = r.mobile ? maskMobile(r.mobile) : '';
  return r.kind === 'charge' ? `شارژ ${op} ${who}`.trim() : `بسته اینترنت ${op} ${r.label ?? ''} (${who})`.replace(/\s+/g, ' ').trim();
}

/** what to give the bank's code or payment app, as a line to copy */
export function requestDetails(r: PayRequest): { label: string; value: string }[] {
  if (r.kind === 'bill')
    return [
      { label: 'شناسه قبض', value: r.billId ?? '' },
      { label: 'شناسه پرداخت', value: r.paymentId ?? '' },
    ];
  return [
    { label: 'شماره', value: r.mobile ?? '' },
    { label: 'مبلغ (تومان)', value: String(Math.round(r.amountRial / 10)) },
  ];
}

/** «*780#» → «tel:*780%23» (the dialer opens with the code; the user presses call). Only star codes are accepted. */
export function ussdHref(code: string): string | null {
  const c = code
    .trim()
    .replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x)))
    .replace(/＊/g, '*')
    .replace(/＃/g, '#');
  if (!/^\*[0-9*]{1,20}#$/.test(c)) return null;
  return `tel:${c.replace(/#/g, '%23')}`;
}

/** The bank's record of this payment, if it is already here: a booked expense or a queued SMS of the same amount, ±2 days. */
export function payMatches(d: FinanceData, amountRial: number, date: Iso): { txns: Txn[]; staged: Staged[] } {
  const amt = Math.round(amountRial);
  const near = (x: Iso | null) => !!x && x >= addDays(date, -2) && x <= addDays(date, 2);
  const used = new Set((d.payRequests ?? []).map((r) => r.txnId).filter(Boolean));
  return {
    txns: d.txns.filter((t) => t.kind === 'expense' && t.amountRial === amt && !t.link && near(t.date) && !used.has(t.id)).slice(-5),
    staged: d.inbox.filter((s) => s.amountRial === amt && s.direction !== 'in' && near(s.date ?? null) && !s.balanceOnly).slice(0, 5),
  };
}

/** Tracked bills (وام، چک و قبض) this bill payment could be, for the user to pick: same service word in its name, or same amount. */
export function trackedBillCandidates(d: FinanceData, r: PayRequest): Bill[] {
  if (r.kind !== 'bill') return [];
  const word = BILL_TYPE_FA[r.billType ?? -1];
  return d.bills.filter((b) => b.active && ((word && b.name.includes(word.split(' ')[0])) || b.amountRial === r.amountRial));
}

export interface CompleteInput {
  accountId: string;
  date: Iso;
  /** the amount actually paid, when it differs (a package's real price) */
  amountRial?: number;
  categoryId?: string | null;
  trackingCode?: string | null;
  linkTxnId?: string | null;
  stagedId?: string | null;
  /** a tracked bill the user said this is: marked paid for the month */
  billRefId?: string | null;
}

export interface PayReceipt {
  requestId: string;
  txnId: string;
  how: 'new' | 'linked' | 'staged';
  before?: Txn;
  staged?: Staged;
  billRef?: { id: string; mk: string; added: boolean } | null;
}

/** «پرداخت شد»: books the request as one expense named after it. Returns an error message and changes nothing when incomplete. */
export function completeRequest(d: FinanceData, requestId: string, inp: CompleteInput, now = Date.now()): PayReceipt | string {
  const r = (d.payRequests ?? []).find((x) => x.id === requestId);
  if (!r || r.status !== 'pending') return 'این درخواست دیگر باز نیست.';
  if (!d.accounts.some((a) => a.id === inp.accountId)) return 'از کدام حساب پرداخت شد؟';
  const amountRial = Math.round(inp.amountRial ?? r.amountRial);
  if (!(amountRial > 0)) return 'مبلغ را بنویسید.';
  const bill = inp.billRefId ? d.bills.find((b) => b.id === inp.billRefId) : null;
  if (inp.billRefId && !bill) return 'آن قبض در «وام، چک و قبض» پیدا نشد.';
  const cat = inp.categoryId && d.categories.some((c) => c.id === inp.categoryId && c.kind === 'expense') ? inp.categoryId : d.categories.some((c) => c.id === 'c-bills') ? 'c-bills' : null;
  const code = inp.trackingCode?.replace(/\s+/g, '').slice(0, 30) || null;
  const note = [requestTitle(r), code ? `کد پیگیری ${code}` : null].filter(Boolean).join(' — ');
  let receipt: PayReceipt;
  let t: Txn;
  if (inp.linkTxnId) {
    const x = d.txns.find((y) => y.id === inp.linkTxnId && y.kind === 'expense' && y.amountRial === amountRial && !y.link);
    if (!x) return 'آن تراکنش بانک دیگر با همین مبلغ پیدا نشد.';
    receipt = { requestId: r.id, txnId: x.id, how: 'linked', before: { ...x } };
    x.note = [note, x.note].filter(Boolean).join(' — ').slice(0, 160);
    x.categoryId = cat;
    t = x;
  } else if (inp.stagedId) {
    const s = d.inbox.find((y) => y.id === inp.stagedId);
    if (!s || s.amountRial !== amountRial) return 'آن پیامک بانک دیگر در صف نیست یا مبلغش فرق دارد.';
    const copy = { ...s };
    const ids = new Set(d.txns.map((y) => y.id));
    const err = commitStaged(d, s.id, { choice: 'expense', accountId: inp.accountId, categoryId: cat, date: s.date ?? inp.date });
    if (err) return err;
    t = d.txns.find((y) => !ids.has(y.id))!;
    t.note = [note, t.note].filter(Boolean).join(' — ').slice(0, 160);
    receipt = { requestId: r.id, txnId: t.id, how: 'staged', staged: copy };
  } else {
    t = { id: newId('t'), date: inp.date, kind: 'expense', amountRial, accountId: inp.accountId, categoryId: cat, note: note.slice(0, 160), addedAt: now };
    d.txns.push(t);
    receipt = { requestId: r.id, txnId: t.id, how: 'new' };
  }
  if (bill) {
    const mk = monthKey(monthOf(t.date));
    const added = !bill.paidMonths.includes(mk);
    if (added) bill.paidMonths.push(mk);
    t.link = { type: 'bill', id: bill.id };
    receipt.billRef = { id: bill.id, mk, added };
  }
  r.status = 'done';
  r.doneAt = now;
  r.txnId = t.id;
  r.trackingCode = code;
  r.amountRial = amountRial;
  return receipt;
}

/** «برگرداندن»: exactly what completeRequest did, undone — the request open again. */
export function undoComplete(d: FinanceData, rc: PayReceipt): void {
  if (rc.how === 'linked' && rc.before) {
    const i = d.txns.findIndex((x) => x.id === rc.txnId);
    if (i >= 0) d.txns[i] = rc.before;
  } else {
    d.txns = d.txns.filter((x) => x.id !== rc.txnId);
    if (rc.how === 'staged' && rc.staged && !d.inbox.some((x) => x.id === rc.staged!.id)) d.inbox.push(rc.staged);
  }
  if (rc.billRef?.added) {
    const b = d.bills.find((x) => x.id === rc.billRef!.id);
    if (b) b.paidMonths = b.paidMonths.filter((m) => m !== rc.billRef!.mk);
  }
  const r = (d.payRequests ?? []).find((x) => x.id === rc.requestId);
  if (r) {
    r.status = 'pending';
    r.doneAt = null;
    r.txnId = null;
    r.trackingCode = null;
  }
}

/** the user's own lines and bills, most used first — for «تکرار» */
export function favorites(d: FinanceData): { key: string; request: PayRequest; count: number }[] {
  const by = new Map<string, { request: PayRequest; count: number }>();
  for (const r of d.payRequests ?? []) {
    if (r.status !== 'done') continue;
    const key = r.kind === 'bill' ? `bill:${r.billId}` : `${r.kind}:${r.mobile}:${r.label ?? ''}:${r.amountRial}`;
    const x = by.get(key);
    if (x) {
      x.count++;
      if (r.createdAt > x.request.createdAt) x.request = r;
    } else by.set(key, { request: r, count: 1 });
  }
  return [...by.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || b.request.createdAt - a.request.createdAt);
}
