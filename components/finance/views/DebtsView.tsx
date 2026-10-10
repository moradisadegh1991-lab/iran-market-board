'use client';
import { useState } from 'react';
import { effectiveAnnualPct, loanSchedule, loanState, monthKey, monthOf, dayInMonth } from '@/lib/finance/calc';
import { newId, tomanToRial, type Cheque, type ChequeStatus, type FinanceData, type Loan } from '@/lib/finance/model';
import { Empty, PageHead } from '../../ui';
import { editLoan } from '@/lib/finance/actions';
import DueList from '../DueList';
import People from '../People';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card, confirmDelete, Disclosure, fmtDateFa, fmtPctFa, JalaliDate, Money, NumInput, parseAmount, SelectBox, TextInput, TomanInput } from '../kit';

const CHEQUE_STATUS: Record<ChequeStatus, string> = { pending: 'در انتظار', cleared: 'پاس شد', bounced: 'برگشت خورد' };

/** New loan, or edit one (`initial`); `onSave` returns an error message to show, or null. */
function LoanForm({ initial, onSave }: { initial?: Loan; onSave: (l: Loan) => string | null | void }) {
  const { today } = useFinance();
  const [name, setName] = useState(initial?.name ?? '');
  const [direction, setDirection] = useState<Loan['direction']>(initial?.direction ?? 'borrowed');
  const [amount, setAmount] = useState(initial ? String(Math.round(initial.principalRial / 10)) : '');
  const [rate, setRate] = useState(initial ? String(initial.annualRatePct) : '23');
  const [months, setMonths] = useState(initial ? String(initial.months) : '36');
  const [first, setFirst] = useState(initial?.firstDueDate ?? today);
  const [paid, setPaid] = useState(initial ? String(initial.paidCount) : '0');
  const [err, setErr] = useState<string | null>(null);
  const P = parseAmount(amount);
  const r = parseAmount(rate);
  const n = Math.round(parseAmount(months));
  const preview = P > 0 && n > 0 && r >= 0 ? loanSchedule({ principalRial: tomanToRial(P), annualRatePct: r, months: n, firstDueDate: first }) : null;

  return (
    <div className="fin-grid">
      <TextInput label="عنوان" value={name} onChange={setName} placeholder="مثلاً وام ازدواج بانک ملی" />
      <SelectBox<Loan['direction']> label="نوع" value={direction} onChange={setDirection} options={[{ key: 'borrowed', label: 'بدهی من (وام گرفته‌ام / قسطی خریده‌ام)' }, { key: 'lent', label: 'طلب من (وام قسطی که داده‌ام)' }]} />
      <TomanInput label="اصل مبلغ (تومان)" value={amount} onChange={setAmount} />
      <NumInput label="نرخ سود سالانه (٪)" value={rate} onChange={setRate} hint="قرض‌الحسنه یا قرض دوستانه: ۰ (کارمزد ۴٪ را هم می‌شود به‌عنوان نرخ داد)" />
      <NumInput label="تعداد اقساط (ماه)" value={months} onChange={setMonths} hint="بدهی یک‌جا: ۱" />
      <JalaliDate label="سررسید اولین قسط" value={first} onChange={setFirst} />
      <NumInput label="اقساطی که تا امروز پرداخت شده" value={paid} onChange={setPaid} />
      <div className="fin-span">
        {initial ? <p className="muted small">اقساطی که در دفتر ثبت شده‌اند همان‌طور می‌مانند؛ جدول اقساط باقی‌مانده با شرایط تازه دوباره حساب می‌شود.</p> : null}
        {preview ? (
          <p className="muted small">
            قسط ماهانه <Money rial={preview[0].paymentRial} /> · کل سود <Money rial={preview.reduce((s, x) => s + x.interestRial, 0)} /> · نرخ مؤثر سالانه {fmtPctFa(effectiveAnnualPct(r), 1)}
          </p>
        ) : null}
      </div>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            const pc = Math.round(parseAmount(paid) || 0);
            if (!name.trim()) return setErr('عنوان را بنویسید.');
            if (!(P > 0) || !(n > 0) || !(r >= 0)) return setErr('مبلغ، نرخ و تعداد اقساط را درست وارد کنید.');
            if (pc < 0 || pc > n) return setErr('تعداد اقساط پرداخت‌شده نامعتبر است.');
            const e = onSave({ id: initial?.id ?? newId('l'), name: name.trim(), direction, principalRial: tomanToRial(P), annualRatePct: r, months: n, firstDueDate: first, paidCount: pc });
            setErr(e || null);
          }}
        >
          ذخیره
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </div>
  );
}

function Loans({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="وام‌ها و اقساط">
      {d.loans.length ? (
        <ul className="fin-list">
          {d.loans.map((l) => {
            const st = loanState(l, today);
            const sched = open === l.id ? loanSchedule(l) : null;
            return (
              <li key={l.id} className="fin-list-block">
                <div className="fin-list-row">
                  <span className="fin-list-main">
                    <b>
                      {l.direction === 'borrowed' ? '🏦' : '🤝'} {l.name}
                    </b>
                    <small>
                      {l.direction === 'borrowed' ? 'بدهی' : 'طلب'}، {fmtPctFa(l.annualRatePct, 1)} سالانه، {(l.paidCount).toLocaleString('fa-IR')} از {l.months.toLocaleString('fa-IR')} قسط پرداخت شده
                      {st.overdue.length ? <span className="down"> · {st.overdue.length.toLocaleString('fa-IR')} قسط عقب</span> : null}
                    </small>
                  </span>
                  <span className="fin-list-nums">
                    <Money rial={st.remainingPrincipalRial} short />
                    <small>
                      قسط <Money rial={st.installmentRial} short />
                    </small>
                  </span>
                  <button className="fin-mini" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                    جدول اقساط
                  </button>
                  <button className="fin-mini" onClick={() => setEditing(editing === l.id ? null : l.id)} aria-expanded={editing === l.id}>
                    ویرایش
                  </button>
                  <button className="fin-mini ghost" onClick={() => confirmDelete(`«${l.name}»`) && update((dr) => void (dr.loans = dr.loans.filter((x) => x.id !== l.id)))}>
                    حذف
                  </button>
                </div>
                {editing === l.id ? (
                  <div className="fin-edit">
                    <LoanForm
                      initial={l}
                      onSave={(next) => {
                        let err: string | null = null;
                        update((dr) => {
                          err = editLoan(dr, l.id, next);
                        });
                        if (!err) setEditing(null);
                        return err;
                      }}
                    />
                  </div>
                ) : null}
                {sched ? (
                  <div className="table-scroll">
                    <table className="t fin-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>سررسید</th>
                          <th>قسط</th>
                          <th>سود</th>
                          <th>اصل</th>
                          <th>مانده</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sched.map((x) => (
                          <tr key={x.n} className={x.n <= l.paidCount ? 'muted' : x.dueDate < today ? 'down' : ''}>
                            <td>{x.n.toLocaleString('fa-IR')}</td>
                            <td>{fmtDateFa(x.dueDate)}</td>
                            <td>
                              <Money rial={x.paymentRial} />
                            </td>
                            <td>
                              <Money rial={x.interestRial} />
                            </td>
                            <td>
                              <Money rial={x.principalRial} />
                            </td>
                            <td>
                              <Money rial={x.remainingRial} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>وام یا قرضی ثبت نشده.</Empty>
      )}
      <Disclosure label="+ وام / قرض تازه">
        {(close) => (
          <LoanForm
            onSave={(l) => {
              update((dr) => void dr.loans.push(l));
              close();
            }}
          />
        )}
      </Disclosure>
    </Card>
  );
}

function Cheques({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [direction, setDirection] = useState<Cheque['direction']>('issued');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(today);
  const [who, setWho] = useState('');
  const sorted = [...d.cheques].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || (a.dueDate < b.dueDate ? -1 : 1));
  return (
    <Card title="چک‌ها">
      {sorted.length ? (
        <ul className="fin-list">
          {sorted.map((c) => (
            <li key={c.id} className={c.status === 'pending' && c.dueDate < today ? 'overdue' : ''}>
              <span className="fin-list-main">
                <b>
                  {c.direction === 'issued' ? '✍️ صادره' : '📥 دریافتی'} — {c.counterparty || 'بی‌نام'}
                </b>
                <small>سررسید {fmtDateFa(c.dueDate)}</small>
              </span>
              <Money rial={c.direction === 'issued' ? -c.amountRial : c.amountRial} signed />
              <select
                className="fin-input sm"
                aria-label="وضعیت چک"
                value={c.status}
                onChange={(e) => update((dr) => void (dr.cheques.find((x) => x.id === c.id)!.status = e.target.value as ChequeStatus))}
              >
                {Object.entries(CHEQUE_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button className="fin-mini ghost" onClick={() => confirmDelete('این چک') && update((dr) => void (dr.cheques = dr.cheques.filter((x) => x.id !== c.id)))}>
                حذف
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>چکی ثبت نشده.</Empty>
      )}
      <p className="note">«پاس شد» از اینجا فقط وضعیت را عوض می‌کند. برای اینکه مبلغ از حساب کم/به آن اضافه شود، از فهرست سررسیدها بالای صفحه «پرداخت شد» را بزنید.</p>
      <Disclosure label="+ چک تازه">
        {(close) => (
          <div className="fin-grid">
            <SelectBox<Cheque['direction']> label="نوع" value={direction} onChange={setDirection} options={[{ key: 'issued', label: 'صادره (من داده‌ام)' }, { key: 'received', label: 'دریافتی (به من داده‌اند)' }]} />
            <TomanInput value={amount} onChange={setAmount} />
            <JalaliDate label="تاریخ سررسید" value={due} onChange={setDue} />
            <TextInput label="در وجه / از طرف" value={who} onChange={setWho} placeholder="فقط روی همین دستگاه می‌ماند" />
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  const t = parseAmount(amount);
                  if (!(t > 0)) return;
                  update((dr) => void dr.cheques.push({ id: newId('c'), direction, amountRial: tomanToRial(t), dueDate: due, counterparty: who.trim(), status: 'pending' }));
                  setAmount('');
                  setWho('');
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
    </Card>
  );
}

function Bills({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const expenseCats = d.categories.filter((c) => c.kind === 'expense');
  const [cat, setCat] = useState('c-bills');
  const [paidThisMonth, setPaidThisMonth] = useState(true);
  const dueDay = Math.min(31, Math.max(1, Math.round(parseAmount(day) || 1)));
  const passed = dayInMonth(monthOf(today), dueDay) < today;
  return (
    <Card title="پرداخت‌های ماهانه (اجاره، شارژ، بیمه، قبض، شهریه…)">
      {d.bills.length ? (
        <ul className="fin-list">
          {d.bills.map((b) => (
            <li key={b.id} className={b.active ? '' : 'muted'}>
              <span className="fin-list-main">
                <b>{b.name}</b>
                <small>
                  هر ماه، روز {b.dueDay.toLocaleString('fa-IR')}؛ {b.paidMonths.includes(monthKey(monthOf(today))) ? 'این ماه پرداخت شده' : 'این ماه پرداخت نشده'}
                </small>
              </span>
              <Money rial={-b.amountRial} signed />
              <button className="fin-mini" onClick={() => update((dr) => void (dr.bills.find((x) => x.id === b.id)!.active = !b.active))}>
                {b.active ? 'توقف' : 'فعال‌سازی'}
              </button>
              <button className="fin-mini ghost" onClick={() => confirmDelete(`«${b.name}»`) && update((dr) => void (dr.bills = dr.bills.filter((x) => x.id !== b.id)))}>
                حذف
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>پرداخت ماهانه‌ای ثبت نشده.</Empty>
      )}
      <Disclosure label="+ پرداخت ماهانه تازه">
        {(close) => (
          <div className="fin-grid">
            <TextInput label="عنوان" value={name} onChange={setName} placeholder="مثلاً اجاره خانه" />
            <TomanInput value={amount} onChange={setAmount} />
            <NumInput label="روز سررسید در ماه (۱ تا ۳۱)" value={day} onChange={setDay} />
            <SelectBox label="دسته" value={cat} onChange={setCat} options={expenseCats.map((c) => ({ key: c.id, label: `${c.emoji} ${c.name}` }))} />
            {passed ? (
              <label className="toggle fin-span">
                <input type="checkbox" checked={paidThisMonth} onChange={(e) => setPaidThisMonth(e.target.checked)} />
                <span className="track" aria-hidden="true" />
                سررسید این ماه گذشته؛ این ماه را قبلاً پرداخت کرده‌ام
              </label>
            ) : null}
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  const t = parseAmount(amount);
                  if (!name.trim() || !(t > 0)) return;
                  update(
                    (dr) =>
                      void dr.bills.push({
                        id: newId('b'),
                        name: name.trim(),
                        amountRial: tomanToRial(t),
                        dueDay,
                        categoryId: cat,
                        paidMonths: passed && paidThisMonth ? [monthKey(monthOf(today))] : [],
                        active: true,
                      }),
                  );
                  setName('');
                  setAmount('');
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
    </Card>
  );
}

function Debts({ d }: { d: FinanceData }) {
  return (
    <>
      <PageHead title="وام، چک و قبض">
        هر تعهدی که تاریخ دارد. سررسیدهای ۶۰ روز آینده این بالا جمع شده‌اند؛ «پرداخت شد» هم وضعیت را به‌روز می‌کند و هم تراکنشش را در حساب ثبت می‌کند.
      </PageHead>
      <Card title="سررسیدهای ۶۰ روز آینده">
        <DueList data={d} days={60} />
      </Card>
      <People d={d} />
      <Loans d={d} />
      <Cheques d={d} />
      <Bills d={d} />
    </>
  );
}

export default function DebtsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Debts d={d} />}</WithBook>
    </div>
  );
}
