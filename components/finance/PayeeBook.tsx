'use client';
// دفترچه شماره کارت و شبا (rule 92): other people's card, شبا and account numbers on the accounts page — checked as they are
// typed (bank-ids.ts), copied with one tap, and what can and cannot be converted said plainly. On the device only (rule 7).
import { useState } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { cardInfo, guessKind, shebaInfo, type BankIdKind } from '@/lib/finance/bank-ids';
import { addNumber, checkNumber, numberText, removeNumber, removePayee, searchPayees } from '@/lib/finance/payees';
import type { FinanceData, Payee, PayeeNumber } from '@/lib/finance/model';
import { Empty } from '../ui';
import { useFinance } from './FinanceProvider';
import { Card, confirmDelete, Disclosure, TextInput } from './kit';

const KIND_LABEL: Record<BankIdKind, string> = { card: 'کارت', sheba: 'شبا', account: 'حساب' };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // an older WebView without the clipboard API: the classic way
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function shown(x: PayeeNumber): string {
  return x.kind === 'card' ? cardInfo(x.value).formatted : x.kind === 'sheba' ? shebaInfo(x.value).formatted : x.value;
}

function NumberRow({ p, x }: { p: Payee; x: PayeeNumber }) {
  const { update } = useFinance();
  const [copied, setCopied] = useState<string | null>(null);
  const inside = x.kind === 'sheba' ? shebaInfo(x.value).account : null;
  const copy = async (what: string, text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    }
  };
  return (
    <li className="payee-num" data-testid="payee-number">
      <span className="payee-kind">{KIND_LABEL[x.kind]}</span>
      <span className="payee-val">
        <bdi dir="ltr" className="num">
          {shown(x)}
        </bdi>
        <small className="muted">
          {[x.label, x.bank].filter(Boolean).join('، ') || (x.kind === 'account' ? 'بانک نامشخص' : '')}
          {inside ? <span data-testid="sheba-account">؛ شماره حساب در همین شبا: <bdi dir="ltr">{inside}</bdi></span> : null}
        </small>
      </span>
      <span className="payee-acts">
        <button type="button" className="fin-mini" onClick={() => void copy('n', x.value)} aria-label={`کپی ${KIND_LABEL[x.kind]}`}>
          {copied === 'n' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied === 'n' ? 'کپی شد' : 'کپی'}
        </button>
        <button type="button" className="fin-mini" onClick={() => void copy('t', numberText(p, x))} aria-label="کپی با نام و بانک">
          {copied === 't' ? 'کپی شد' : 'با نام'}
        </button>
        <button
          type="button"
          className="fin-mini ghost"
          aria-label={`حذف ${KIND_LABEL[x.kind]}`}
          onClick={() => {
            if (confirmDelete(`${KIND_LABEL[x.kind]} ${shown(x)}`)) update((d) => removeNumber(d, p.id, x.id));
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}

/** one input for any number: what it is, which bank, whether it checks out — while typing */
function NumberField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const kind = guessKind(value);
  const c = value.trim() ? checkNumber(value, kind) : null;
  return (
    <div className="fin-field fin-span">
      <label>
        <span className="fin-label">شماره کارت، شبا یا حساب</span>
        <input className="fin-input num" dir="ltr" inputMode="text" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder="6037… یا IR…" />
      </label>
      <small className={c && typeof c === 'string' ? 'fin-err' : 'fin-hint'} data-testid="number-check">
        {!c
          ? 'نوعش از خود شماره معلوم می‌شود: ۱۶ رقم کارت، IR و ۲۴ رقم شبا، بقیه شماره حساب.'
          : typeof c === 'string'
            ? c
            : `${KIND_LABEL[c.kind]}${c.bank ? ` ${c.bank}` : ''} — ${c.kind === 'account' ? 'شماره حساب رقم کنترلی ندارد که اپ بسنجد؛ با دقت بنویسید.' : 'رقم کنترل درست است.'}${c.account ? ` شماره حساب داخلش: ${c.account}` : ''}`}
      </small>
    </div>
  );
}

function AddForm({ d, preset, onDone }: { d: FinanceData; preset?: Payee; onDone?: () => void }) {
  const { update } = useFinance();
  const [name, setName] = useState(preset?.name ?? '');
  const [num, setNum] = useState('');
  const [bank, setBank] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const isAccount = guessKind(num) === 'account';
  return (
    <div className="fin-grid">
      {preset ? null : <TextInput label="نام صاحب حساب" value={name} onChange={setName} placeholder="مثلاً علی رضایی" list="payee-names" />}
      <datalist id="payee-names">
        {(d.payees ?? []).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <NumberField value={num} onChange={setNum} />
      {isAccount && num.trim() ? <TextInput label="بانک این حساب" value={bank} onChange={setBank} placeholder="مثلاً ملت" /> : null}
      <TextInput label="یادداشت (اختیاری)" value={label} onChange={setLabel} placeholder="مثلاً حساب حقوق" />
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: unknown = null;
            update((dr) => {
              r = addNumber(dr, preset?.name ?? name, num, { bank, label });
            });
            if (typeof r === 'string') return setErr(r);
            setErr(null);
            setMsg(`ذخیره شد: ${preset?.name ?? name.trim()}`);
            setNum('');
            setBank('');
            setLabel('');
            onDone?.();
          }}
        >
          ذخیره در دفترچه
        </button>
        {err ? (
          <span className="fin-err" role="alert">
            {err}
          </span>
        ) : msg ? (
          <span className="muted small" role="status">
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PayeeItem({ d, p }: { d: FinanceData; p: Payee }) {
  const { update } = useFinance();
  const [adding, setAdding] = useState(false);
  return (
    <li className="fin-list-block" data-testid="payee">
      <div className="fin-list-row">
        <span className="fin-list-main">
          <b>{p.name}</b>
          {p.note ? <small>{p.note}</small> : null}
        </span>
        <button className="fin-mini" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          + شماره
        </button>
        <button
          className="fin-mini ghost"
          onClick={() => {
            if (confirmDelete(`${p.name} و همه شماره‌هایش`)) update((dr) => removePayee(dr, p.id));
          }}
        >
          حذف
        </button>
      </div>
      {p.numbers.length ? (
        <ul className="payee-nums">
          {p.numbers.map((x) => (
            <NumberRow key={x.id} p={p} x={x} />
          ))}
        </ul>
      ) : null}
      {adding ? <AddForm d={d} preset={p} onDone={() => setAdding(false)} /> : null}
    </li>
  );
}

export default function PayeeBook({ d }: { d: FinanceData }) {
  const [q, setQ] = useState('');
  const all = d.payees ?? [];
  const list = searchPayees(d, q);
  return (
    <Card title="دفترچه شماره کارت و شبا">
      <p className="muted small">شماره کارت، شبا و حساب افراد برای کارت‌به‌کارت و پایا؛ فقط روی همین گوشی است و هیچ‌جا فرستاده نمی‌شود (جز فایل پشتیبانی که خودتان می‌گیرید).</p>
      {all.length > 4 ? (
        <TextInput label="جست‌وجو" value={q} onChange={setQ} placeholder="نام یا چند رقم از شماره" />
      ) : null}
      {all.length ? (
        list.length ? (
          <ul className="fin-list">
            {list.map((p) => (
              <PayeeItem key={p.id} d={d} p={p} />
            ))}
          </ul>
        ) : (
          <p className="note">کسی با این نام یا شماره پیدا نشد.</p>
        )
      ) : (
        <Empty>هنوز شماره‌ای ذخیره نشده.</Empty>
      )}
      <Disclosure label="+ افزودن شماره کارت، شبا یا حساب">{() => <AddForm d={d} />}</Disclosure>
      <details className="payee-conv">
        <summary>این شماره‌ها به هم تبدیل می‌شوند؟</summary>
        <ul>
          <li>
            <b>از روی خود شماره (همین‌جا، بدون اینترنت):</b> بانکِ کارت از ۶ رقم اول و بانکِ شبا از رقم‌های ۵ تا ۷؛ درستی کارت با رقم کنترل (الگوریتم لون) و درستی
            شبا با دو رقم کنترلش (باقی‌مانده بر ۹۷) سنجیده می‌شود، پس یک رقم جاافتاده یا جابه‌جا را می‌گیرد.
          </li>
          <li>
            <b>شبا ← شماره حساب:</b> شماره حساب همیشه داخل شباست، ولی هر بانک آن را به شکل خودش می‌گذارد؛ اپ فقط برای پارسیان، پاسارگاد و شهر قاعده‌اش را
            دارد (از کتابخانه متن‌باز persian-tools، با حساب واقعی سنجیده نشده) و آن را «شماره حساب در همین شبا» نشان می‌دهد.
          </li>
          <li>
            <b>کارت ← شبا یا حساب، حساب ← شبا، و نام صاحب حساب:</b> از روی شماره حساب‌شدنی نیست؛ فقط بانک (از راه شاپرک و سامانه‌های استعلام بانک مرکزی) آن را
            می‌داند. راه رایگانش «تبدیل کارت به شبا» در اپ یا اینترنت‌بانک بانک خودتان است. سرویس‌های استعلام (مثل فینوتک و جیبیت) فقط با قرارداد و پرداخت به
            کسب‌وکارها داده می‌شوند و شماره را از گوشی بیرون می‌برند — برای همین در اپ ساخته نشده.
          </li>
        </ul>
      </details>
    </Card>
  );
}
