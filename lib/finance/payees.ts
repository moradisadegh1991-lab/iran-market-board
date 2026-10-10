// دفترچه شماره کارت و شبا (rule 92): other people's card, شبا and account numbers, kept on the device. A number is checked
// before it is kept (bank-ids.ts): a card whose check digit fails or a شبا whose check digits fail is refused — it is
// certainly mistyped, and money sent to it goes nowhere or to a stranger. An account number has no check the app can make.
import { accountNoInfo, cardInfo, guessKind, shebaInfo, type BankIdKind } from './bank-ids';
import { newId, type FinanceData, type Payee, type PayeeNumber } from './model';

const norm = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ').trim();

export function payees(d: FinanceData): Payee[] {
  return (d.payees ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

/** a number checked and in its stored form, or why it cannot be kept */
export function checkNumber(raw: string, kind: BankIdKind = guessKind(raw)): { kind: BankIdKind; value: string; bank: string | null; account: string | null } | string {
  if (!raw.trim()) return 'شماره را بنویسید.';
  if (kind === 'card') {
    const c = cardInfo(raw);
    return c.ok ? { kind, value: c.digits, bank: c.bank, account: null } : c.problem!;
  }
  if (kind === 'sheba') {
    const s = shebaInfo(raw);
    return s.ok ? { kind, value: s.iban, bank: s.bank, account: s.account } : s.problem!;
  }
  const a = accountNoInfo(raw);
  return a.ok ? { kind, value: a.digits, bank: null, account: null } : a.problem!;
}

/** the person, made on first use; a name is matched without regard to ی/ي, ک/ك or spacing */
export function payeeByName(d: FinanceData, name: string): Payee {
  d.payees ??= [];
  const n = norm(name);
  const hit = d.payees.find((p) => norm(p.name) === n);
  if (hit) return hit;
  const p: Payee = { id: newId('pe'), name: n, numbers: [] };
  d.payees.push(p);
  return p;
}

/**
 * Adds a number to a person (made if new). The same number twice is one entry. An account number's bank is what the user
 * picked; a card's and a شبا's come from the number itself.
 */
export function addNumber(d: FinanceData, name: string, raw: string, opts: { kind?: BankIdKind; bank?: string | null; label?: string } = {}): PayeeNumber | string {
  if (!norm(name)) return 'نام صاحب حساب را بنویسید.';
  const c = checkNumber(raw, opts.kind);
  if (typeof c === 'string') return c;
  const p = payeeByName(d, name);
  const same = p.numbers.find((x) => x.kind === c.kind && x.value === c.value);
  if (same) return same;
  const x: PayeeNumber = { id: newId('pn'), kind: c.kind, value: c.value, bank: c.bank ?? (opts.bank?.trim() || null), ...(opts.label?.trim() ? { label: opts.label.trim() } : {}) };
  p.numbers.push(x);
  return x;
}

export function removeNumber(d: FinanceData, payeeId: string, numberId: string): void {
  const p = (d.payees ?? []).find((x) => x.id === payeeId);
  if (!p) return;
  p.numbers = p.numbers.filter((x) => x.id !== numberId);
}

export function removePayee(d: FinanceData, payeeId: string): void {
  d.payees = (d.payees ?? []).filter((x) => x.id !== payeeId);
}

export function editPayee(d: FinanceData, payeeId: string, patch: { name?: string; note?: string }): string | null {
  const p = (d.payees ?? []).find((x) => x.id === payeeId);
  if (!p) return 'پیدا نشد.';
  if (patch.name !== undefined) {
    if (!norm(patch.name)) return 'نام خالی است.';
    p.name = norm(patch.name);
  }
  if (patch.note !== undefined) p.note = patch.note.trim() || undefined;
  return null;
}

/** what is copied or shared for one number: «علی رضایی — شبا IR.. (بانک ملت)» */
export function numberText(p: Payee, x: PayeeNumber): string {
  const what = x.kind === 'card' ? 'کارت' : x.kind === 'sheba' ? 'شبا' : 'حساب';
  const shown = x.kind === 'card' ? cardInfo(x.value).formatted : x.kind === 'sheba' ? shebaInfo(x.value).formatted : x.value;
  return `${p.name} — ${what} ${shown}${x.bank ? ` (${x.bank})` : ''}`;
}

/** finds people by name, or by any part of a number (the last four digits of a card, say) */
export function searchPayees(d: FinanceData, q: string): Payee[] {
  const t = norm(q);
  if (!t) return payees(d);
  const digits = t.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/\D/g, '');
  return payees(d).filter((p) => norm(p.name).includes(t) || (digits.length >= 3 && p.numbers.some((x) => x.value.includes(digits))));
}
