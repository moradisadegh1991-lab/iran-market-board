'use client';
import { useState } from 'react';
import { bookLendWithSms } from '@/lib/finance/lend-sms';
import { addDays } from '@/lib/finance/calc';
import { isPerson, LEND_LABEL, lendSmsCandidates, people, type LendKind } from '@/lib/finance/lending';
import { newId, tomanToRial, type FinanceData, type TxnKind } from '@/lib/finance/model';
import { Chips } from '../ui';
import { useFinance } from './FinanceProvider';
import { JalaliDate, parseAmount, SelectBox, TextInput, TomanInput } from './kit';
import Assistant from '../assistant/Assistant';

type FormKind = TxnKind | 'loan';
const KINDS: { key: FormKind; label: string }[] = [
  { key: 'expense', label: 'هزینه' },
  { key: 'income', label: 'درآمد' },
  { key: 'transfer', label: 'انتقال بین حساب‌ها' },
  { key: 'loan', label: 'قرض' },
];
const LEND_KINDS: { key: LendKind; label: string }[] = (['lend', 'borrow', 'repaid', 'repay'] as LendKind[]).map((k) => ({ key: k, label: LEND_LABEL[k] }));

/** Add one transaction. Amount is typed in toman and stored in rial (×10, once, here). */
export default function TxnForm({ data, onDone, compact }: { data: FinanceData; onDone?: () => void; compact?: boolean }) {
  const { update, today } = useFinance();
  // people lent to or borrowed from have their own field (قرض), not the account lists
  const accounts = data.accounts.filter((a) => !a.archived && !isPerson(a));
  const [kind, setKind] = useState<FormKind>('expense');
  const [lendKind, setLendKind] = useState<LendKind>('lend');
  const [person, setPerson] = useState('');
  // when a loan is to be paid back — optional; reminded `settings.reminderDays` before (rule 90)
  const [hasDue, setHasDue] = useState(false);
  const [dueOn, setDueOn] = useState(() => addDays(today, 30));
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
    if (kind === 'loan') {
      if (!person.trim()) return setErr('نام کسی را که قرض داده یا گرفته بنویسید.');
      const withDue = hasDue && (lendKind === 'lend' || lendKind === 'borrow');
      if (withDue && dueOn <= date) return setErr('موعد بازپرداخت باید بعد از تاریخ قرض باشد.');
      let r: unknown = null;
      let withSms = false;
      update((d) => {
        // the bank's SMS of the same money, if it is already here, is this loan — booked once (rule 88)
        const acc = d.accounts.find((a) => a.id === accountId);
        const sms = lendSmsCandidates(d, { kind: lendKind, amountRial: tomanToRial(t), accountId, side: acc?.bizId ? 'biz' : 'me', today: date })[0] ?? null;
        withSms = !!sms;
        r = bookLendWithSms(d, { kind: lendKind, person, accountId, amountRial: tomanToRial(t), date, note, dueOn: withDue ? dueOn : null }, sms);
      });
      if (typeof r === 'string') return setErr(r);
      setErr(null);
      setSaved(`ثبت شد: ${LEND_LABEL[lendKind]} (${person.trim()}) ${amount}${withSms ? ' — با همان پیامک بانک، یک بار' : ''}${withDue ? `؛ ${data.settings.reminderDays.toLocaleString('fa-IR')} روز قبل از موعد یادآوری می‌شود` : ''}`);
      setHasDue(false);
      setAmount('');
      setNote('');
      onDone?.();
      return;
    }
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
      {kind === 'loan' ? (
        <div className="fin-span">
          <Chips label="کدام قرض" options={LEND_KINDS} value={lendKind} onChange={setLendKind} />
        </div>
      ) : null}
      <TomanInput value={amount} onChange={setAmount} />
      <SelectBox
        label={kind === 'transfer' ? 'از حساب' : kind === 'loan' ? (lendKind === 'lend' || lendKind === 'repay' ? 'از حساب' : 'به حساب') : 'حساب'}
        value={accountId}
        onChange={setAccountId}
        options={accounts.map((a) => ({ key: a.id, label: a.bizId ? `${a.name} (کسب‌وکار)` : a.name }))}
      />
      {kind === 'loan' ? (
        <>
          <TextInput label={{ lend: 'به چه کسی قرض دادید؟', borrow: 'از چه کسی قرض گرفتید؟', repaid: 'چه کسی پس داد؟', repay: 'به چه کسی پس دادید؟' }[lendKind]} value={person} onChange={setPerson} placeholder="مثلاً علی" list="lend-people" />
          <datalist id="lend-people">
            {people(data, data.accounts.find((a) => a.id === accountId)?.bizId ?? null).map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
          {lendKind === 'lend' || lendKind === 'borrow' ? (
            <>
              <label className="toggle fin-span">
                <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />
                <span className="track" aria-hidden="true" />
                {lendKind === 'lend' ? 'قرار است تا تاریخ مشخصی پس بدهد' : 'قرار است تا تاریخ مشخصی پس بدهم'} (یادآوری می‌شود)
              </label>
              {hasDue ? <JalaliDate label="موعد بازپرداخت" value={dueOn} onChange={setDueOn} yearsBack={0} yearsAhead={5} /> : null}
            </>
          ) : null}
          <p className="fin-span muted small">
            قرض درآمد یا خرج نیست: در «بدهی، طلب و گروه» به‌عنوان طلب یا بدهی شما می‌ماند تا پس داده شود.
            {data.accounts.find((a) => a.id === accountId)?.bizId ? ' از حساب کسب‌وکار است، پس جزو طلب و بدهی کسب‌وکار ثبت می‌شود، نه شخصی.' : ''}
          </p>
        </>
      ) : kind === 'transfer' ? (
        <SelectBox label="به حساب" value={toAccountId} onChange={setToAccountId} options={accounts.map((a) => ({ key: a.id, label: a.name }))} />
      ) : (
        <>
          <SelectBox label="دسته" value={catValue} onChange={setCategoryId} options={cats.map((c) => ({ key: c.id, label: `${c.emoji} ${c.name}` }))} />
          {catValue === 'i-loanback' ? (
            <p className="fin-span fin-hint" data-testid="loanback-hint">
              اگر آن قرض را با «قرض» ثبت کرده‌اید، این‌جا نوع «قرض › قرضش را پس داد» را بزنید تا هم طلبتان کم شود و هم دوبار درآمد حساب نشود.
            </p>
          ) : null}
        </>
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
