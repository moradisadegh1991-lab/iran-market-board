'use client';
// شارژ، بسته اینترنت و قبض (rule 106): the request is prepared here (operator from the prefix, the bill's service and amount
// from its own IDs), paid in the user's own bank code or payment app, and booked as one expense named after it when they say
// «پرداخت شد» — the bank's SMS of the same payment becomes that expense instead of a second one. On the device only (rule 7).
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { isMoneyAccount, rialToTomanN, tomanToRial, type FinanceData, type PayRequest } from '@/lib/finance/model';
import {
  billFromText,
  checkBill,
  completeRequest,
  favorites,
  makeRequest,
  normalizeMobile,
  OPERATOR_FA,
  operatorOf,
  payMatches,
  requestDetails,
  requestTitle,
  trackedBillCandidates,
  undoComplete,
  ussdHref,
  type Operator,
  type PayReceipt,
  type RequestInput,
} from '@/lib/finance/pay';
import { Glyph } from '../../icons';
import { Empty, PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card, Field, fmtDateFa, JalaliDate, Modal, Money, parseAmount, Tabs, TomanInput } from '../kit';
import { copyText } from '../PayeeBook';

const faN = (n: number) => n.toLocaleString('fa-IR');
const USSD_KEY = 'imf.pay.ussd.v1';
const ACCT_KEY = 'imf.pay.acct.v1';
const DEFAULT_USSD = '*780#';
const CHARGE_TOMAN = [10_000, 20_000, 50_000, 100_000, 200_000];
const remembered = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // a convenience only
  }
};

type Tab = 'charge' | 'package' | 'bill' | 'history';

function addRequest(update: ReturnType<typeof useFinance>['update'], inp: RequestInput): string | null {
  const r = makeRequest(inp);
  if (typeof r === 'string') return r;
  update((dr) => {
    dr.payRequests = [...(dr.payRequests ?? []), r];
  });
  return null;
}

/** شارژ and بسته: the line, its operator (a suggestion — numbers move between operators) and the amount */
function LineForm({ d, kind }: { d: FinanceData; kind: 'charge' | 'package' }) {
  const { update } = useFinance();
  const lines = useMemo(() => [...new Set((d.payRequests ?? []).filter((r) => r.mobile).map((r) => r.mobile!))].slice(-8).reverse(), [d.payRequests]);
  const [mobile, setMobile] = useState(lines[0] ?? '');
  const [op, setOp] = useState<Operator | ''>('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const norm = normalizeMobile(mobile);
  const suggested = norm ? operatorOf(norm) : null;
  const operator: Operator | '' = op || suggested || '';

  const submit = () => {
    const e = addRequest(update, { kind, mobile, operator: operator || null, label, amountRial: amount ? tomanToRial(parseAmount(amount)) : 0 });
    setErr(e);
    if (!e) {
      setAmount('');
      setLabel('');
    }
  };

  return (
    <Card title={kind === 'charge' ? 'خرید شارژ' : 'خرید بسته اینترنت'}>
      <form
        className="fin-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="شماره موبایل" hint={norm && !suggested ? 'اپراتور این پیش‌شماره را نمی‌دانم؛ انتخابش کنید.' : undefined}>
          <input
            className="fin-input num"
            inputMode="tel"
            aria-label="شماره موبایل"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
              setOp('');
            }}
            placeholder="09xxxxxxxxx"
            list="pay-lines"
            autoComplete="tel"
            data-testid="pay-mobile"
          />
          <datalist id="pay-lines">
            {lines.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="اپراتور" hint={suggested ? 'از پیش‌شماره حدس زده شد؛ اگر خط ترابرد شده، عوضش کنید.' : undefined}>
          <select className="fin-input" aria-label="اپراتور" value={operator} onChange={(e) => setOp(e.target.value as Operator)} data-testid="pay-op">
            <option value="">انتخاب کنید</option>
            {(Object.keys(OPERATOR_FA) as Operator[]).map((k) => (
              <option key={k} value={k}>
                {OPERATOR_FA[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'package' ? (
          <Field label="کدام بسته" hint="همان‌طور که در منوی بانک یا اپراتور می‌بینید.">
            <input className="fin-input" aria-label="کدام بسته" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً ۳۰ روزه ۲۰ گیگ" data-testid="pay-label" />
          </Field>
        ) : null}
        <TomanInput label={kind === 'charge' ? 'مبلغ شارژ (تومان)' : 'قیمت بسته (تومان)'} value={amount} onChange={setAmount} />
        {kind === 'charge' ? (
          <div className="shop-chips" aria-label="مبلغ‌های رایج">
            {CHARGE_TOMAN.map((t) => (
              <button key={t} type="button" className={`fin-chip${parseAmount(amount) === t ? ' on' : ''}`} onClick={() => setAmount(String(t))}>
                {faN(t / 1000)} هزار
              </button>
            ))}
          </div>
        ) : null}
        <div className="fin-actions">
          <button className="fin-mini" type="submit" data-testid="pay-make">
            آماده کردن درخواست
          </button>
        </div>
      </form>
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
    </Card>
  );
}

/** قبض: the two IDs, typed or pasted from the bill SMS / barcode; the service and amount read from them and checked */
function BillForm({ initialBillId = '' }: { initialBillId?: string }) {
  const { update } = useFinance();
  const [paste, setPaste] = useState('');
  const [billId, setBillId] = useState(initialBillId);
  const [payId, setPayId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const c = billId && payId ? checkBill(billId, payId) : null;

  const fromPaste = (t: string) => {
    setPaste(t);
    const x = billFromText(t);
    if (x) {
      setBillId(x.billId);
      setPayId(x.paymentId);
    }
  };
  const submit = () => {
    const e = addRequest(update, { kind: 'bill', billId, paymentId: payId });
    setErr(e);
    if (!e) {
      setBillId('');
      setPayId('');
      setPaste('');
    }
  };

  return (
    <Card title="پرداخت قبض (آب، برق، گاز، تلفن)">
      <Field label="چسباندن پیامک قبض یا بارکد (اختیاری)" hint="شناسه‌ها خودشان پیدا می‌شوند.">
        <textarea className="fin-input" rows={2} aria-label="چسباندن پیامک قبض" value={paste} onChange={(e) => fromPaste(e.target.value)} data-testid="pay-paste" />
      </Field>
      <form
        className="fin-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="شناسه قبض">
          <input className="fin-input num" inputMode="numeric" aria-label="شناسه قبض" value={billId} onChange={(e) => setBillId(e.target.value)} data-testid="pay-billid" />
        </Field>
        <Field label="شناسه پرداخت">
          <input className="fin-input num" inputMode="numeric" aria-label="شناسه پرداخت" value={payId} onChange={(e) => setPayId(e.target.value)} data-testid="pay-payid" />
        </Field>
        <div className="fin-actions">
          <button className="fin-mini" type="submit" disabled={!c || c.errors.length > 0} data-testid="pay-make">
            آماده کردن درخواست
          </button>
        </div>
      </form>
      {c ? (
        c.errors.length ? (
          <p className="fin-err" role="alert" data-testid="pay-billcheck">
            {c.errors[0]}
          </p>
        ) : (
          <p className="fin-ok" role="status" data-testid="pay-billcheck">
            قبض {c.typeFa}، مبلغ <Money rial={c.amountRial} /> — شناسه‌ها درست‌اند.
          </p>
        )
      ) : null}
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="pay-copy">
      <span className="muted small">{label}</span>
      <b className="num">{value}</b>
      <button
        className="fin-mini ghost"
        aria-label={`کپی ${label}`}
        onClick={() =>
          void copyText(value).then((ok) => {
            setDone(ok);
            if (ok) setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? <Glyph.Check size={14} aria-hidden="true" /> : <Glyph.Copy size={14} aria-hidden="true" />} {done ? 'کپی شد' : 'کپی'}
      </button>
    </div>
  );
}

/** «پرداخت شد»: which account, when, the tracking code; the bank's SMS of the same payment and a tracked bill offered, never assumed */
function Complete({ d, r, onDone, onClose }: { d: FinanceData; r: PayRequest; onDone: (rc: PayReceipt) => void; onClose: () => void }) {
  const { update, today } = useFinance();
  const accounts = d.accounts.filter((a) => isMoneyAccount(a) && !a.bizId);
  const [accountId, setAccountId] = useState(() => {
    const x = remembered(ACCT_KEY);
    return accounts.some((a) => a.id === x) ? x : (accounts.find((a) => a.kind === 'bank') ?? accounts[0])?.id ?? '';
  });
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(String(rialToTomanN(r.amountRial)));
  const [code, setCode] = useState('');
  const [match, setMatch] = useState(''); // '' = not chosen yet, 'new', 't:<id>', 's:<id>'
  const [billRef, setBillRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const amountRial = amount ? tomanToRial(parseAmount(amount)) : 0;
  const m = amountRial > 0 ? payMatches(d, amountRial, date) : { txns: [], staged: [] };
  const hasMatch = m.txns.length + m.staged.length > 0;
  const chosen = hasMatch ? match : 'new';
  const bills = trackedBillCandidates(d, r);
  const pick = (v: string) => {
    setMatch(v);
    setErr(null);
  };

  const save = () => {
    if (hasMatch && !chosen) return setErr('آیا این همان پیامک بانک است؟ یکی را انتخاب کنید.');
    let res: PayReceipt | string = '';
    update((dr) => {
      res = completeRequest(dr, r.id, {
        accountId,
        date,
        amountRial,
        trackingCode: code || null,
        linkTxnId: chosen.startsWith('t:') ? chosen.slice(2) : null,
        stagedId: chosen.startsWith('s:') ? chosen.slice(2) : null,
        billRefId: billRef || null,
      });
    });
    if (typeof res === 'string') return setErr(res);
    remember(ACCT_KEY, accountId);
    onDone(res);
  };

  return (
    <Modal title="پرداخت شد" onClose={onClose}>
      <p className="small">{requestTitle(r)}</p>
      <div className="fin-grid">
        <Field label="از کدام حساب">
          <select className="fin-input" aria-label="از کدام حساب" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <TomanInput label="مبلغ پرداخت‌شده (تومان)" value={amount} onChange={setAmount} />
        <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsBack={1} yearsAhead={0} />
        <Field label="کد پیگیری (اختیاری)">
          <input className="fin-input num" aria-label="کد پیگیری" value={code} onChange={(e) => setCode(e.target.value)} data-testid="pay-code" />
        </Field>
      </div>
      {hasMatch ? (
        <fieldset className="shop-match" data-testid="pay-match">
          <legend>پرداختی با همین مبلغ در دفتر یا صف پیامک هست. همین است؟</legend>
          {m.txns.map((t) => (
            <label key={t.id} className="fin-radio">
              <input type="radio" name="pay-match" checked={chosen === `t:${t.id}`} onChange={() => pick(`t:${t.id}`)} />
              بله، همین تراکنش ثبت‌شده: {fmtDateFa(t.date)}
              {t.time ? ` ساعت ${t.time}` : ''} — {t.note || 'بی‌توضیح'}
            </label>
          ))}
          {m.staged.map((s) => (
            <label key={s.id} className="fin-radio">
              <input type="radio" name="pay-match" checked={chosen === `s:${s.id}`} onChange={() => pick(`s:${s.id}`)} />
              بله، همین پیامک بانک در صف: {s.date ? fmtDateFa(s.date) : 'بی‌تاریخ'}
              {s.time ? ` ساعت ${s.time}` : ''} — {s.description}
            </label>
          ))}
          <label className="fin-radio">
            <input type="radio" name="pay-match" checked={chosen === 'new'} onChange={() => pick('new')} />
            نه، پرداخت جداگانه‌ای است (تراکنش تازه)
          </label>
        </fieldset>
      ) : null}
      {bills.length ? (
        <fieldset className="shop-match" data-testid="pay-billref">
          <legend>این قبض را در «وام، چک و قبض» دارید؟ (پرداخت این ماه علامت می‌خورد)</legend>
          {bills.map((b) => (
            <label key={b.id} className="fin-radio">
              <input type="radio" name="pay-billref" checked={billRef === b.id} onChange={() => setBillRef(b.id)} />
              {b.name} (<Money rial={b.amountRial} />)
            </label>
          ))}
          <label className="fin-radio">
            <input type="radio" name="pay-billref" checked={billRef === ''} onChange={() => setBillRef('')} />
            هیچ‌کدام
          </label>
        </fieldset>
      ) : null}
      <div className="fin-actions">
        <button className="fin-mini" onClick={save} disabled={!(amountRial > 0) || !accountId} data-testid="pay-save">
          ثبت در دفتر
        </button>
        <button className="fin-mini ghost" onClick={onClose}>
          انصراف
        </button>
      </div>
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
    </Modal>
  );
}

/** one open request: what to give the bank's code, the code to dial, «پرداخت شد» / «لغو» */
function Pending({ d, r, ussd, onDone }: { d: FinanceData; r: PayRequest; ussd: string; onDone: (rc: PayReceipt) => void }) {
  const { update } = useFinance();
  const [open, setOpen] = useState(false);
  const href = ussdHref(ussd);
  return (
    <li className="pay-req" data-testid="pay-pending">
      <div className="pay-req-head">
        <b>{requestTitle(r)}</b>
        <Money rial={r.amountRial} />
      </div>
      {requestDetails(r).map((x) => (
        <CopyRow key={x.label} label={x.label} value={x.value} />
      ))}
      <div className="fin-actions">
        {href ? (
          <a className="fin-mini ghost" href={href} data-testid="pay-dial">
            <Glyph.Phone size={14} aria-hidden="true" /> شماره‌گیری <span className="num">{ussd}</span>
          </a>
        ) : null}
        <button className="fin-mini" onClick={() => setOpen(true)} data-testid="pay-done">
          پرداخت شد
        </button>
        <button
          className="fin-mini ghost"
          onClick={() =>
            update((dr) => {
              dr.payRequests = (dr.payRequests ?? []).filter((x) => x.id !== r.id);
            })
          }
          data-testid="pay-cancel"
        >
          لغو
        </button>
      </div>
      {open ? (
        <Complete
          d={d}
          r={r}
          onClose={() => setOpen(false)}
          onDone={(rc) => {
            setOpen(false);
            onDone(rc);
          }}
        />
      ) : null}
    </li>
  );
}

function UssdSetting({ ussd, setUssd }: { ussd: string; setUssd: (s: string) => void }) {
  const [v, setV] = useState(ussd);
  const ok = !!ussdHref(v);
  return (
    <details className="pay-ussd">
      <summary className="small">کد بانک یا اپ پرداخت: <span className="num">{ussd}</span> (عوض کردن)</summary>
      <Field label="کد USSD" hint="پیش‌فرض *780# (آپ) است؛ اگر با کد بانک خودتان پرداخت می‌کنید، همان را بنویسید.">
        <input className="fin-input num" aria-label="کد USSD" value={v} onChange={(e) => setV(e.target.value)} dir="ltr" data-testid="pay-ussd" />
      </Field>
      <button
        className="fin-mini ghost"
        disabled={!ok}
        onClick={() => {
          setUssd(v.trim());
          remember(USSD_KEY, v.trim());
        }}
      >
        ذخیره
      </button>
      {!ok && v ? <p className="fin-err small">کد باید با * شروع و با # تمام شود.</p> : null}
    </details>
  );
}

function History({ d, onBill }: { d: FinanceData; onBill: (billId: string) => void }) {
  const { update } = useFinance();
  const done = (d.payRequests ?? []).filter((r) => r.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const favs = favorites(d).slice(0, 6);
  // the day of the booked transaction (the bank's day when it came from the SMS), not the moment the button was pressed
  const paidOn = (r: PayRequest) => d.txns.find((t) => t.id === r.txnId)?.date ?? null;
  // a bill has a new payment ID every period: «تکرار» brings its bill ID back and asks for the new one
  const again = (r: PayRequest) =>
    r.kind === 'bill' ? onBill(r.billId ?? '') : addRequest(update, { kind: r.kind, mobile: r.mobile, operator: r.operator ?? null, label: r.label, amountRial: r.amountRial });
  if (!done.length) return <Empty art="transactions">هنوز چیزی پرداخت نکرده‌اید. درخواست اول را از زبانه شارژ، بسته یا قبض بسازید.</Empty>;
  return (
    <>
      {favs.length ? (
        <Card title="تکرار سریع">
          <div className="shop-chips">
            {favs.map((f) => (
              <button key={f.key} className="fin-chip" onClick={() => again(f.request)} data-testid="pay-again">
                {requestTitle(f.request)} (<Money rial={f.request.amountRial} short />)
              </button>
            ))}
          </div>
          <p className="muted small">قبض هر دوره شناسه پرداخت تازه دارد؛ «تکرار» قبض شناسه قبض را می‌آورد و شناسه پرداخت این دوره را می‌پرسد.</p>
        </Card>
      ) : null}
      <Card title={`پرداخت‌شده‌ها (${faN(done.length)})`}>
        <ul className="pay-list">
          {done.map((r) => (
            <li key={r.id} className="pay-hist" data-testid="pay-hist">
              <span>
                <b>{requestTitle(r)}</b>
                <small className="muted">
                  {' '}
                  {paidOn(r) ? fmtDateFa(paidOn(r)!) : ''}
                  {r.trackingCode ? `، کد پیگیری ${r.trackingCode}` : ''}
                </small>
              </span>
              <Money rial={r.amountRial} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Pay({ d }: { d: FinanceData }) {
  const { update } = useFinance();
  const [tab, setTab] = useState<Tab>('charge');
  const [ussd, setUssd] = useState(() => remembered(USSD_KEY) || DEFAULT_USSD);
  const [receipt, setReceipt] = useState<PayReceipt | null>(null);
  const [billPrefill, setBillPrefill] = useState('');
  const pending = (d.payRequests ?? []).filter((r) => r.status === 'pending');

  return (
    <>
      <PageHead title="شارژ، بسته و قبض">
        درخواست را این‌جا آماده کنید (اپراتور از پیش‌شماره، نوع و مبلغ قبض از روی شناسه‌ها)، با کد بانک یا اپ پرداخت خودتان بپردازید و بعد «پرداخت شد» را بزنید تا یک هزینه
        به نام همین درخواست در دفتر ثبت شود. اگر پیامک بانکِ همین پرداخت رسیده، همان ثبت می‌شود، نه دوباره. پرداخت از داخل این اپ انجام نمی‌شود و پولی از سرور ما رد نمی‌شود.
      </PageHead>
      {receipt ? (
        <p className="fin-ok" role="status" data-testid="pay-booked">
          ثبت شد ({receipt.how === 'new' ? 'تراکنش تازه' : receipt.how === 'staged' ? 'از پیامک بانک در صف' : 'روی همان تراکنش پیامک بانک'}
          {receipt.billRef ? '، قبض این ماه پرداخت‌شده علامت خورد' : ''}). <Link href="/transactions">دیدن تراکنش‌ها</Link>{' '}
          <button
            className="fin-mini ghost"
            onClick={() => {
              update((dr) => undoComplete(dr, receipt));
              setReceipt(null);
            }}
            data-testid="pay-undo"
          >
            برگرداندن
          </button>
        </p>
      ) : null}
      {pending.length ? (
        <Card title={`در انتظار پرداخت (${faN(pending.length)})`}>
          <ul className="pay-list">
            {pending.map((r) => (
              <Pending key={r.id} d={d} r={r} ussd={ussd} onDone={setReceipt} />
            ))}
          </ul>
          <UssdSetting ussd={ussd} setUssd={setUssd} />
          <p className="muted small">
            کد را بزنید تا صفحه شماره‌گیر باز شود، از منوی آن «شارژ»، «بسته اینترنت» یا «قبض» را انتخاب کنید و شماره یا شناسه‌ها را (با دکمه کپی) بدهید. منوی هر کد کمی فرق دارد.
          </p>
        </Card>
      ) : null}
      <Tabs
        label="نوع درخواست"
        idPrefix="pay-tab"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'charge', label: 'شارژ' },
          { key: 'package', label: 'بسته', title: 'بسته اینترنت' },
          { key: 'bill', label: 'قبض' },
          { key: 'history', label: 'پیشینه', badge: (d.payRequests ?? []).filter((r) => r.status === 'done').length || undefined },
        ]}
      />
      <div id="pay-tab-panel" role="tabpanel" aria-labelledby={`pay-tab-${tab}`}>
        {tab === 'charge' ? <LineForm key="c" d={d} kind="charge" /> : tab === 'package' ? <LineForm key="p" d={d} kind="package" /> : tab === 'bill' ? (
          <BillForm key={`b${billPrefill}`} initialBillId={billPrefill} />
        ) : (
          <History
            d={d}
            onBill={(id) => {
              setBillPrefill(id);
              setTab('bill');
            }}
          />
        )}
      </div>
    </>
  );
}

export default function PayView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Pay d={d} />}</WithBook>
    </div>
  );
}
