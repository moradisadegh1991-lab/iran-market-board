'use client';
import { useState } from 'react';
import { daysBetween, upcoming, type Due } from '@/lib/finance/calc';
import { settleDue } from '@/lib/finance/actions';
import type { FinanceData } from '@/lib/finance/model';
import { Empty } from '../ui';
import { useFinance } from './FinanceProvider';
import { fmtDateFa, Money, parseAmount } from './kit';
import { tomanToRial } from '@/lib/finance/model';

const TYPE_ICON: Record<Due['type'], string> = { loan: '🏦', cheque: '✍️', bill: '🧾', income: '💼' };

function when(today: string, date: string): string {
  const d = daysBetween(today, date);
  if (d < 0) return `${(-d).toLocaleString('fa-IR')} روز گذشته`;
  if (d === 0) return 'امروز';
  if (d === 1) return 'فردا';
  return `${d.toLocaleString('fa-IR')} روز دیگر`;
}

/** Upcoming and overdue obligations, each settleable in one tap (which also records the transaction). */
export default function DueList({ data, days = 30, limit }: { data: FinanceData; days?: number; limit?: number }) {
  const { update, today } = useFinance();
  const accounts = data.accounts.filter((a) => !a.archived && a.kind !== 'person');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  // an expected income asks what actually came in (a salary is rarely the same twice)
  const [receiving, setReceiving] = useState<string | null>(null);
  const [actual, setActual] = useState('');
  const all = upcoming(data, today, days);
  const rows = limit ? all.slice(0, limit) : all;

  if (!all.length) return <Empty>در {days.toLocaleString('fa-IR')} روز آینده قسط، چک، قبض یا درآمد پیش‌بینی‌شده‌ای ثبت نشده.</Empty>;

  function settle(x: Due, actualRial?: number | null) {
    let err: string | null = null;
    update((d) => {
      err = settleDue(d, x, accountId, today, actualRial);
    });
    setMsg(err ?? `«${x.label}» ثبت شد و تراکنشش به حساب رفت.`);
    setReceiving(null);
  }

  return (
    <div>
      <div className="fin-due-head">
        <label className="select">
          <span>پرداخت/دریافت از</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {msg ? (
          <span className="muted small" role="status">
            {msg}
          </span>
        ) : null}
      </div>
      <ul className="fin-list">
        {rows.map((x) => (
          <li key={x.key} className={x.overdue ? 'overdue' : ''}>
            <span className="fin-list-icon" aria-hidden="true">
              {TYPE_ICON[x.type]}
            </span>
            <span className="fin-list-main">
              <b>{x.label}</b>
              <small>
                {fmtDateFa(x.date)} · <span className={x.overdue ? 'down' : ''}>{when(today, x.date)}</span>
              </small>
            </span>
            <Money rial={x.rial} signed />
            {x.type === 'income' && receiving === x.key ? (
              <span className="fin-receive">
                <input
                  className="fin-input sm"
                  inputMode="numeric"
                  aria-label="مبلغ دریافتی (تومان)"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                />
                <button className="fin-mini" onClick={() => settle(x, parseAmount(actual) > 0 ? tomanToRial(parseAmount(actual)) : null)} disabled={!accountId}>
                  ثبت
                </button>
              </span>
            ) : (
              <button
                className="fin-mini"
                disabled={!accountId}
                onClick={() => {
                  if (x.type !== 'income') return settle(x);
                  setReceiving(x.key);
                  setActual(String(Math.round(x.rial / 10)));
                }}
              >
                {x.rial < 0 ? 'پرداخت شد' : 'دریافت شد'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {limit && all.length > limit ? <p className="note">و {(all.length - limit).toLocaleString('fa-IR')} مورد دیگر در صفحه «وام، چک و قبض».</p> : null}
    </div>
  );
}
