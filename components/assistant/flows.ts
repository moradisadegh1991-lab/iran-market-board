// The assistant's dialogs besides the plain transaction (lib/finance/voice.ts): a sale or a booking (lib/biz/voice.ts,
// rule 81) and a loan (lib/finance/voice-lend.ts, rule 84). Each is the same shape — ask, read back, record on «بله»,
// take back on «برگرداندن» — so the assistant drives them through one table.
import { bizAnswer, bizChoose, bizEdit, bizRows, commitBiz, undoBiz, type BizUndo, type BizVoiceState } from '@/lib/biz/voice';
import { commitLend, lendAnswer, lendChoose, lendEdit, lendRows, undoLend, type LendState, type LendUndo } from '@/lib/finance/voice-lend';
import type { FinanceData, Iso } from '@/lib/finance/model';

export type Flow = { kind: 'biz'; st: BizVoiceState } | { kind: 'lend'; st: LendState };
export type FlowSaved = { kind: 'biz'; u: BizUndo } | { kind: 'lend'; u: LendUndo };
type Row = { key: string; label: string; value: string | null };

const BIZ_UNDONE: Record<BizUndo['kind'], string> = {
  sale: 'برگردانده شد؛ آن فاکتور لغو شد.',
  book: 'برگردانده شد؛ آن نوبت حذف شد.',
  done: 'برگردانده شد؛ نوبت دوباره باز شد و فروشش لغو شد.',
  cancel: 'برگردانده شد؛ نوبت دوباره باز شد.',
};

export function flowAnswer(d: FinanceData, f: Flow, alts: string[], today: Iso, now: number): Flow {
  return f.kind === 'biz' ? { kind: 'biz', st: bizAnswer(d, f.st, alts, today, now) } : { kind: 'lend', st: lendAnswer(d, f.st, alts) };
}
export function flowChoose(d: FinanceData, f: Flow, key: string, today: Iso, now: number): Flow {
  return f.kind === 'biz' ? { kind: 'biz', st: bizChoose(d, f.st, key, today, now) } : { kind: 'lend', st: lendChoose(d, f.st, key) };
}
export function flowEdit(d: FinanceData, f: Flow, key: string, today: Iso, now: number): Flow {
  return f.kind === 'biz' ? { kind: 'biz', st: bizEdit(d, f.st, key, today, now) } : { kind: 'lend', st: lendEdit(d, f.st, key) };
}
/** records it (inside FinanceProvider.update); the undo, or why not */
export function flowCommit(d: FinanceData, f: Flow, today: Iso, now: number): FlowSaved | string {
  if (f.kind === 'biz') {
    const r = commitBiz(d, f.st, now);
    return typeof r === 'string' ? r : { kind: 'biz', u: r };
  }
  const r = commitLend(d, f.st, today);
  return typeof r === 'string' ? r : { kind: 'lend', u: r };
}
export function flowUndo(d: FinanceData, s: FlowSaved, now: number): string {
  if (s.kind === 'biz') {
    undoBiz(d, s.u, now);
    return BIZ_UNDONE[s.u.kind];
  }
  undoLend(d, s.u);
  return 'برگردانده شد؛ آن قرض از دفتر حذف شد.';
}
/** what the bot says once it is recorded */
export const flowSavedText = (s: FlowSaved) => (s.kind === 'biz' && s.u.kind === 'sale' ? `ثبت شد؛ فاکتور ${s.u.no.toLocaleString('fa-IR')}.` : 'ثبت شد.');
export const flowRows = (d: FinanceData, f: Flow, today: Iso): Row[] => (f.kind === 'biz' ? bizRows(d, f.st, today) : lendRows(d, f.st));
