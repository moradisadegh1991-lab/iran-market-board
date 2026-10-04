'use client';
import { useState } from 'react';
import { newId, tomanToRial, type FinanceData, type TxnKind } from '@/lib/finance/model';
import { Chips } from '../ui';
import { useFinance } from './FinanceProvider';
import { JalaliDate, parseAmount, SelectBox, TextInput, TomanInput } from './kit';
import Assistant from '../assistant/Assistant';

const KINDS: { key: TxnKind; label: string }[] = [
  { key: 'expense', label: 'هزینه' },
  { key: 'income', label: 'درآمد' },
  { key: 'transfer', label: 'انتقال بین حساب‌ها' },
];

/** Add one transaction. Amount is typed in toman and stored in rial (×10, once, here). */
export default function TxnForm({ data, onDone, compact }: { data: FinanceData; onDone?: () => void; compact?: boolean }) {
  const { update, today } = useFinance();
  const accounts = data.accounts.filter((a) => !a.archived);
  const [kind, setKind] = useState<TxnKind>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? '');
  const cats = data.categories.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense'));
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);

  const catValue = cats.some((c) => c.id === categoryId) ? categoryId : cats[0]?.id ?? '';

  function save() {
    const t = parseAmount(amount);
    if (!(t > 0)) return setErr('مبلغ را وارد کنید.');
    if (!accounts.some((a) => a.id === accountId)) return setErr('اول یک حساب بسازید.');
    if (kind === 'transfer' && (!toAccountId || toAccountId === accountId)) return setErr('حساب مقصد باید با مبدأ فرق کند.');
    if (date > today) return setErr('تاریخ نمی‌تواند در آینده باشد؛ پرداخت‌های آینده را در «وام، چک و قبض» ثبت کنید.');
    update((d) => {
      d.txns.push({
        id: newId('t'),
        date,
        kind,
        amountRial: tomanToRial(t),
        accountId,
        toAccountId: kind === 'transfer' ? toAccountId : null,
        categoryId: kind === 'transfer' ? null : catValue || null,
        note: note.trim() || undefined,
      });
    });
    setErr(null);
    setSaved(`ثبت شد: ${KINDS.find((k) => k.key === kind)!.label} ${amount}`);
    setAmount('');
    setNote('');
    onDone?.();
  }

  return (
    <div className={`fin-grid${compact ? ' compact' : ''}`}>
      <div className="fin-span voice-entry">
        <button type="button" className="btn ghost voice-open" onClick={() => setVoice(true)}>
          🎙 ثبت با صدا
        </button>
        <span className="muted small">بگویید «پنجاه هزار تومن نون خریدم از کیف پول»؛ هرچه کم باشد می‌پرسد.</span>
        {voice ? <Assistant mode="txn" onClose={() => setVoice(false)} /> : null}
      </div>
      <div className="fin-span">
        <Chips label="نوع تراکنش" options={KINDS} value={kind} onChange={setKind} />
      </div>
      <TomanInput value={amount} onChange={setAmount} />
      <SelectBox label={kind === 'transfer' ? 'از حساب' : 'حساب'} value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ key: a.id, label: a.name }))} />
      {kind === 'transfer' ? (
        <SelectBox label="به حساب" value={toAccountId} onChange={setToAccountId} options={accounts.map((a) => ({ key: a.id, label: a.name }))} />
      ) : (
        <SelectBox label="دسته" value={catValue} onChange={setCategoryId} options={cats.map((c) => ({ key: c.id, label: `${c.emoji} ${c.name}` }))} />
      )}
      <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsAhead={0} />
      {compact ? null : <TextInput label="توضیح (اختیاری)" value={note} onChange={setNote} placeholder="مثلاً خرید ماهانه" />}
      <div className="fin-span fin-actions">
        <button className="btn" onClick={save}>
          ثبت تراکنش
        </button>
        {err ? <span className="fin-err" role="alert">{err}</span> : saved ? <span className="muted small" role="status">{saved}</span> : null}
      </div>
    </div>
  );
}
