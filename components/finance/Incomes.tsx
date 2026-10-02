'use client';
import { useState } from 'react';
import { dayInMonth, monthForecast, monthKey, monthLabel, monthOf, shiftMonth } from '@/lib/finance/calc';
import { newId, tomanToRial, type ExpectedIncome, type FinanceData } from '@/lib/finance/model';
import { Empty, Toggle } from '../ui';
import { useFinance } from './FinanceProvider';
import { Card, confirmDelete, Disclosure, fmtDateFa, JalaliDate, Money, NumInput, parseAmount, SelectBox, TextInput, TomanInput } from './kit';

/** Add or edit one expected income (a salary every month, or a one-off payment). */
function IncomeForm({ d, initial, onSave }: { d: FinanceData; initial?: ExpectedIncome; onSave: (x: ExpectedIncome) => void }) {
  const { today } = useFinance();
  const incomeCats = d.categories.filter((c) => c.kind === 'income');
  const [name, setName] = useState(initial?.name ?? 'حقوق');
  const [amount, setAmount] = useState(initial ? String(Math.round(initial.amountRial / 10)) : '');
  const [repeat, setRepeat] = useState<ExpectedIncome['repeat']>(initial?.repeat ?? 'monthly');
  const [day, setDay] = useState(String(initial?.day ?? 25));
  const [date, setDate] = useState(initial?.date ?? today);
  const [cat, setCat] = useState(initial?.categoryId ?? 'i-salary');
  const cur = monthOf(today);
  const dueDay = Math.min(31, Math.max(1, Math.round(parseAmount(day) || 1)));
  const passed = !initial && repeat === 'monthly' && dayInMonth(cur, dueDay) < today;
  const [gotThisMonth, setGotThisMonth] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fin-grid">
      <TextInput label="عنوان" value={name} onChange={setName} placeholder="مثلاً حقوق شرکت، اجاره دریافتی، پاداش" />
      <TomanInput label="مبلغ پیش‌بینی‌شده (تومان)" value={amount} onChange={setAmount} />
      <SelectBox<ExpectedIncome['repeat']> label="تکرار" value={repeat} onChange={setRepeat} options={[{ key: 'monthly', label: 'هر ماه' }, { key: 'once', label: 'یک بار' }]} />
      {repeat === 'monthly' ? <NumInput label="روز واریز در ماه (۱ تا ۳۱)" value={day} onChange={setDay} /> : <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsBack={1} yearsAhead={3} />}
      <SelectBox label="دسته" value={cat} onChange={setCat} options={incomeCats.map((c) => ({ key: c.id, label: `${c.emoji} ${c.name}` }))} />
      {passed ? (
        <div className="fin-span">
          <Toggle checked={gotThisMonth} onChange={setGotThisMonth}>
            روز واریز این ماه گذشته؛ این ماه را گرفته‌ام (و در تراکنش‌ها هست یا لازم نیست ثبت شود)
          </Toggle>
        </div>
      ) : null}
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            const t = parseAmount(amount);
            if (!name.trim()) return setErr('عنوان را بنویسید.');
            if (!(t > 0)) return setErr('مبلغ را وارد کنید.');
            const fromMonth = initial?.fromMonth ?? monthKey(cur);
            const received = initial ? initial.receivedMonths : passed && gotThisMonth ? [monthKey(cur)] : [];
            onSave({
              id: initial?.id ?? newId('in'),
              name: name.trim(),
              amountRial: tomanToRial(t),
              repeat,
              day: dueDay,
              date: repeat === 'once' ? date : null,
              categoryId: cat,
              fromMonth,
              receivedMonths: initial && initial.repeat !== repeat ? [] : received,
              active: initial?.active ?? true,
            });
          }}
        >
          ذخیره
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </div>
  );
}

/** Salaries and other expected income: they feed the 60-day list, the cash forecast and the month forecast. */
export function Incomes({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [editing, setEditing] = useState<string | null>(null);
  const cur = monthKey(monthOf(today));
  const list = d.incomes ?? [];
  return (
    <Card title="درآمدهای پیش‌رو (حقوق ماه بعد، اجاره، پاداش…)">
      {list.length ? (
        <ul className="fin-list">
          {list.map((x) => (
            <li key={x.id} className={`fin-list-block${x.active ? '' : ' muted'}`}>
              <div className="fin-list-row">
                <span className="fin-list-main">
                  <b>💼 {x.name}</b>
                  <small>
                    {x.repeat === 'monthly'
                      ? `هر ماه، روز ${x.day.toLocaleString('fa-IR')} · این ماه ${x.receivedMonths.includes(cur) ? 'دریافت شده' : 'هنوز دریافت نشده'}`
                      : `یک بار، ${x.date ? fmtDateFa(x.date) : '—'} · ${x.receivedMonths.includes('once') ? 'دریافت شده' : 'در انتظار'}`}
                    {x.active ? '' : ' · متوقف'}
                  </small>
                </span>
                <Money rial={x.amountRial} signed />
                <button className="fin-mini" onClick={() => setEditing(editing === x.id ? null : x.id)} aria-expanded={editing === x.id}>
                  ویرایش
                </button>
                <button className="fin-mini" onClick={() => update((dr) => void (dr.incomes.find((y) => y.id === x.id)!.active = !x.active))}>
                  {x.active ? 'توقف' : 'فعال‌سازی'}
                </button>
                <button className="fin-mini ghost" onClick={() => confirmDelete(`«${x.name}»`) && update((dr) => void (dr.incomes = dr.incomes.filter((y) => y.id !== x.id)))}>
                  حذف
                </button>
              </div>
              {editing === x.id ? (
                <IncomeForm
                  d={d}
                  initial={x}
                  onSave={(next) => {
                    update((dr) => void (dr.incomes = dr.incomes.map((y) => (y.id === x.id ? next : y))));
                    setEditing(null);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>حقوق یا درآمدی که منتظرش هستید ثبت نشده. با ثبتش، پیش‌بینی ماه و فهرست سررسیدها آن را هم حساب می‌کنند.</Empty>
      )}
      <Disclosure label="+ درآمد پیش‌بینی‌شده تازه" defaultOpen={!list.length}>
        {(close) => (
          <IncomeForm
            d={d}
            onSave={(x) => {
              update((dr) => void (dr.incomes ??= []).push(x));
              close();
            }}
          />
        )}
      </Disclosure>
      <p className="note">روز واریز که برسد، در «سررسیدها» (خانه و صفحه وام و قبض) دکمه «دریافت شد» می‌آید؛ مبلغ واقعی را همان‌جا می‌نویسید و تراکنش درآمدش ثبت می‌شود.</p>
    </Card>
  );
}

function ForecastColumn({ d, offset }: { d: FinanceData; offset: 0 | 1 }) {
  const { today } = useFinance();
  const m = shiftMonth(monthOf(today), offset);
  const f = monthForecast(d, m, today);
  const income = f.incomeActualRial + f.incomeExpectedRial;
  const expense = f.expenseActualRial + f.obligationsRial + f.everydayRial;
  return (
    <div className="fin-forecast">
      <h3>
        {offset ? 'ماه بعد' : 'این ماه'} — {monthLabel(m)}
      </h3>
      <dl>
        {offset ? null : (
          <div>
            <dt>درآمد ثبت‌شده تا امروز</dt>
            <dd>
              <Money rial={f.incomeActualRial} />
            </dd>
          </div>
        )}
        <div>
          <dt>{f.incomeBasis === 'average' ? 'درآمد باقی‌مانده (از میانگین ۳ ماه، چون درآمد پیش‌بینی‌شده ثبت نکرده‌اید)' : 'درآمد پیش‌بینی‌شده باقی‌مانده'}</dt>
          <dd>
            <Money rial={f.incomeExpectedRial} />
          </dd>
        </div>
        {f.incomeLines.length ? (
          <div className="sub">
            <dt>
              {f.incomeLines.map((x) => (
                <span key={x.label + x.date} className={x.overdue ? 'down' : ''}>
                  {x.label} ({fmtDateFa(x.date)}
                  {x.overdue ? '، دیر شده' : ''}){' '}
                </span>
              ))}
            </dt>
          </div>
        ) : null}
        {offset ? null : (
          <div>
            <dt>هزینه ثبت‌شده تا امروز</dt>
            <dd>
              <Money rial={-f.expenseActualRial} signed />
            </dd>
          </div>
        )}
        <div>
          <dt>اقساط، قبض‌ها و چک‌های باقی‌مانده</dt>
          <dd>
            <Money rial={-f.obligationsRial} signed />
          </dd>
        </div>
        <div>
          <dt>خرج روزمره باقی‌مانده (با سرعت ۹۰ روز اخیر)</dt>
          <dd>
            <Money rial={-f.everydayRial} signed />
          </dd>
        </div>
        <div className="total">
          <dt>پس‌انداز پیش‌بینی‌شده ماه</dt>
          <dd>
            <Money rial={f.netRial} signed className={f.netRial >= 0 ? 'up' : 'down'} />
          </dd>
        </div>
      </dl>
      <small className="muted">
        درآمد کل <Money rial={income} short /> · هزینه کل <Money rial={expense} short />
      </small>
    </div>
  );
}

/** This month and next, as they will probably end. */
export function MonthForecastCard({ d }: { d: FinanceData }) {
  return (
    <Card title="پیش‌بینی درآمد و پس‌انداز">
      <div className="fin-forecast-grid">
        <ForecastColumn d={d} offset={0} />
        <ForecastColumn d={d} offset={1} />
      </div>
      <p className="note">پیش‌بینی است، نه قطعی: درآمدهای بالا را خودتان وارد کرده‌اید و خرج روزمره از روی سرعت خرج ۹۰ روز گذشته (بدون اقساط و قبض‌ها) حساب شده.</p>
    </Card>
  );
}
