'use client';
import { useState } from 'react';
import { addDays } from '@/lib/finance/calc';
import { tomanToRial, type FinanceData } from '@/lib/finance/model';
import { EXPENSE_CAT_LABEL, type Business, type ExpenseCat } from '@/lib/biz/model';
import { addExpense, deleteExpense, rebookDay } from '@/lib/biz/ops';
import { dailyProfit, sumRows } from '@/lib/biz/reports';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtDateFa, JalaliDate, Money, parseAmount, TextInput, TomanInput } from '../finance/kit';
import { Chips } from '../ui';
import { BizAccountSelect, downloadText, fa, firstBizAccount, WithBiz } from './kit';

function AddExpense({ d, b }: { d: FinanceData; b: Business }) {
  const { update, today } = useFinance();
  const [cat, setCat] = useState<ExpenseCat>('supplies');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [acc, setAcc] = useState(firstBizAccount(b));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="fin-grid">
      <label className="fin-field">
        <span className="fin-label">نوع هزینه</span>
        <select className="fin-input" value={cat} onChange={(e) => setCat(e.target.value as ExpenseCat)} aria-label="نوع هزینه">
          {(Object.keys(EXPENSE_CAT_LABEL) as ExpenseCat[]).map((k) => (
            <option key={k} value={k}>
              {EXPENSE_CAT_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <TomanInput label="مبلغ (تومان)" value={amount} onChange={setAmount} />
      <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsAhead={0} />
      <BizAccountSelect d={d} b={b} value={acc} onChange={setAcc} label="پرداخت از" allowNone />
      <TextInput label="توضیح" value={note} onChange={setNote} />
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let e: string | null = null;
            update((dr) => {
              e = addExpense(dr, { category: cat, amountRial: tomanToRial(parseAmount(amount) || 0), date, note, accountId: acc || null });
            });
            setMsg(e ?? 'هزینه ثبت شد ✓');
            if (!e) {
              setAmount('');
              setNote('');
            }
          }}
        >
          ثبت هزینه
        </button>
        {msg ? <span className={msg.endsWith('✓') ? 'fin-ok' : 'fin-err'}>{msg}</span> : null}
      </div>
      <p className="fin-span muted small">خرید مواد و کالا را از «انبار» ثبت کنید: آن‌جا خرج نیست، موجودی است و وقتی فروخته شد به‌عنوان بهای تمام‌شده از سود کم می‌شود.</p>
    </div>
  );
}

function Money_({ d, b }: { d: FinanceData; b: Business }) {
  const { update, today } = useFinance();
  const [span, setSpan] = useState<'14' | '30' | '90'>('14');
  const from = addDays(today, -(+span - 1));
  const rows = dailyProfit(b, from, today);
  const t = sumRows(rows);
  const byCat = new Map<ExpenseCat, number>();
  for (const e of b.expenses) if (e.date >= from && e.date <= today) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountRial);
  const skipped = [...new Set(b.skipBook.map((k) => k.split('|')[0]))];
  return (
    <>
      <dl className="fin-kpis">
        <div className="fin-stat">
          <dt>فروش {fa(+span)} روز</dt>
          <dd>
            <Money rial={t.revenueRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>بهای تمام‌شده</dt>
          <dd>
            <Money rial={t.costRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>هزینه‌ها</dt>
          <dd>
            <Money rial={t.expensesRial} short />
          </dd>
        </div>
        <div className="fin-stat" data-testid="biz-profit">
          <dt>سود خالص</dt>
          <dd className={t.profitRial >= 0 ? 'up' : 'down'}>
            <Money rial={t.profitRial} short signed />
          </dd>
        </div>
      </dl>
      <Card>
        <details className="biz-details">
          <summary>+ ثبت هزینه</summary>
          <AddExpense d={d} b={b} />
        </details>
      </Card>
      <Chips label="بازه" value={span} onChange={setSpan} options={[{ key: '14', label: '۱۴ روز' }, { key: '30', label: '۳۰ روز' }, { key: '90', label: '۹۰ روز' }]} />
      <Card title="سود روزانه">
        <div className="table-scroll">
          <table className="t fin-table">
            <thead>
              <tr>
                <th>روز</th>
                <th>فروش</th>
                <th>بهای تمام‌شده</th>
                <th>هزینه</th>
                <th>سود</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day}>
                  <td>{fmtDateFa(r.day)}</td>
                  <td>
                    <Money rial={r.revenueRial} short />
                  </td>
                  <td>
                    <Money rial={r.costRial} short />
                  </td>
                  <td>
                    <Money rial={r.expensesRial} short />
                  </td>
                  <td className={r.profitRial >= 0 ? 'up' : 'down'}>
                    <Money rial={r.profitRial} short />
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    در این بازه فروش یا هزینه‌ای نیست.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <button
          className="fin-mini ghost"
          onClick={() =>
            downloadText(
              'profit.csv',
              '﻿' + ['روز,فروش (تومان),بهای تمام‌شده,هزینه,سود', ...rows.map((r) => [r.day, r.revenueRial, r.costRial, r.expensesRial, r.profitRial].map((v, i) => (i ? Math.round(+v / 10) : v)).join(','))].join('\n'),
            )
          }
        >
          خروجی اکسل
        </button>
      </Card>
      <Card title="هزینه‌ها">
        {byCat.size ? (
          <p className="small">
            {[...byCat.entries()].map(([k, v], i) => (
              <span key={k}>
                {i ? '، ' : ''}
                {EXPENSE_CAT_LABEL[k]} <Money rial={v} short />
              </span>
            ))}
          </p>
        ) : null}
        <ul className="fin-list">
          {[...b.expenses]
            .reverse()
            .slice(0, 50)
            .map((e) => (
              <li key={e.id} className="fin-list-row">
                <span className="fin-list-main">
                  <b>{EXPENSE_CAT_LABEL[e.category]}</b>
                  <small>
                    {fmtDateFa(e.date)}
                    {e.note ? `، ${e.note}` : ''}
                    {e.accountId ? `، ${d.accounts.find((a) => a.id === e.accountId)?.name ?? ''}` : '، بدون ثبت در دفتر'}
                  </small>
                </span>
                <span className="fin-list-nums">
                  <Money rial={e.amountRial} />
                  <button className="fin-mini ghost" onClick={() => window.confirm('این هزینه حذف شود؟') && update((dr) => deleteExpense(dr, e.id))}>
                    حذف
                  </button>
                </span>
              </li>
            ))}
          {!b.expenses.length ? <li className="empty">هزینه‌ای ثبت نشده.</li> : null}
        </ul>
      </Card>
      {skipped.length ? (
        <Card title="فروش روزهایی که از دفتر برداشتید">
          <p className="small">ردیف «فروش روز» این روزها را از تراکنش‌ها حذف کردید؛ فروششان در گزارش کسب‌وکار هست ولی در حساب‌ها نه.</p>
          <ul className="fin-list">
            {skipped.map((day) => (
              <li key={day} className="fin-list-row">
                <span>{fmtDateFa(day)}</span>
                <button className="fin-mini" onClick={() => update((dr) => rebookDay(dr, day))}>
                  دوباره در دفتر ثبت کن
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

export default function MoneyView() {
  return (
    <WithBiz title="هزینه و سود" lede="سود هر روز = فروش (بدون ارزش افزوده) − بهای تمام‌شده آن‌چه فروخته شد − هزینه‌ها. هزینه‌ای که از حساب مغازه بدهید در دفتر هم ثبت می‌شود.">
      {(d, b) => <Money_ d={d} b={b} />}
    </WithBiz>
  );
}
