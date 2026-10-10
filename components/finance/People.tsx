'use client';
// قرض با اشخاص (rule 84): who owes the user and whom the user owes — personal and business apart — with a quick
// «پس داد / پس دادم» that books the repayment as a transfer (never income or spending).
import { useState } from 'react';
import { bookLend, LEND_LABEL, positions, setPersonDue, type LendKind, type PersonPosition } from '@/lib/finance/lending';
import { addDays, daysBetween } from '@/lib/finance/calc';
import { isMoneyAccount, tomanToRial, type FinanceData } from '@/lib/finance/model';
import { Empty } from '../ui';
import { useFinance } from './FinanceProvider';
import { Card, fmtDateFa, JalaliDate, Money, parseAmount, SelectBox, TomanInput } from './kit';

function Repay({ d, p, onDone }: { d: FinanceData; p: PersonPosition; onDone: () => void }) {
  const { update, today } = useFinance();
  const own = d.accounts.filter((a) => isMoneyAccount(a) && (a.bizId ?? null) === (p.account.bizId ?? null));
  const [amount, setAmount] = useState(String(Math.round(Math.abs(p.balanceRial) / 10)));
  const [accountId, setAccountId] = useState(own[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const kind: LendKind = p.balanceRial > 0 ? 'repaid' : 'repay';
  return (
    <div className="fin-grid fin-edit">
      <TomanInput label="مبلغ (تومان)" value={amount} onChange={setAmount} />
      <SelectBox label={kind === 'repaid' ? 'به حساب' : 'از حساب'} value={accountId} onChange={setAccountId} options={own.map((a) => ({ key: a.id, label: a.name }))} />
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: unknown = null;
            update((dr) => {
              r = bookLend(dr, { kind, person: p.account.name, accountId, amountRial: tomanToRial(parseAmount(amount)), date: today });
            });
            if (typeof r === 'string') return setErr(r);
            onDone();
          }}
        >
          ثبت «{LEND_LABEL[kind]}»
        </button>
        {err ? (
          <span className="fin-err" role="alert">
            {err}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** the repayment date of a loan: set, change or remove — reminded `settings.reminderDays` before (rule 90) */
function DueEdit({ p, onDone }: { p: PersonPosition; onDone: () => void }) {
  const { update, today } = useFinance();
  const [v, setV] = useState(p.account.dueOn ?? addDays(today, 30));
  return (
    <div className="fin-grid fin-edit">
      <JalaliDate label="موعد بازپرداخت" value={v} onChange={setV} yearsBack={1} yearsAhead={5} />
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            update((dr) => void setPersonDue(dr, p.account.id, v));
            onDone();
          }}
        >
          ذخیره موعد
        </button>
        {p.account.dueOn ? (
          <button
            className="fin-mini ghost"
            onClick={() => {
              update((dr) => void setPersonDue(dr, p.account.id, null));
              onDone();
            }}
          >
            برداشتن موعد
          </button>
        ) : null}
      </div>
    </div>
  );
}

function dueText(today: string, due: string): string {
  const n = daysBetween(today, due);
  return `موعد ${fmtDateFa(due)} (${n < 0 ? `${(-n).toLocaleString('fa-IR')} روز گذشته` : n === 0 ? 'امروز' : `${n.toLocaleString('fa-IR')} روز دیگر`})`;
}

function List({ d, rows }: { d: FinanceData; rows: PersonPosition[] }) {
  const { today } = useFinance();
  const [open, setOpen] = useState<string | null>(null);
  const [dueOpen, setDueOpen] = useState<string | null>(null);
  return (
    <ul className="fin-list">
      {rows.map((p) => (
        <li key={p.account.id} className="fin-list-block" data-testid="person">
          <div className="fin-list-row">
            <span className="fin-list-main">
              <b>{p.account.name}</b>
              <small>
                {p.balanceRial > 0
                  ? p.business
                    ? 'به کسب‌وکار بدهکار است'
                    : 'به شما بدهکار است'
                  : p.balanceRial < 0
                    ? p.business
                      ? 'کسب‌وکار به او بدهکار است'
                      : 'شما بدهکارید'
                    : 'تسویه شده'}
                {p.lastDate ? `، آخرین بار ${fmtDateFa(p.lastDate)}` : ''}
              </small>
              {p.balanceRial !== 0 && p.account.dueOn ? (
                <small className={p.account.dueOn < today ? 'down' : ''} data-testid="person-due">
                  {dueText(today, p.account.dueOn)}
                </small>
              ) : null}
            </span>
            <Money rial={Math.abs(p.balanceRial)} className={p.balanceRial > 0 ? 'up' : p.balanceRial < 0 ? 'down' : ''} />
            {p.balanceRial !== 0 ? (
              <button className="fin-mini" onClick={() => setOpen(open === p.account.id ? null : p.account.id)} aria-expanded={open === p.account.id}>
                {p.balanceRial > 0 ? 'پس داد' : 'پس دادم'}
              </button>
            ) : null}
          </div>
          {p.balanceRial !== 0 ? (
            <button className="fin-link small" onClick={() => setDueOpen(dueOpen === p.account.id ? null : p.account.id)} aria-expanded={dueOpen === p.account.id}>
              {p.account.dueOn ? 'تغییر موعد بازپرداخت' : 'تعیین موعد بازپرداخت (یادآوری)'}
            </button>
          ) : null}
          {dueOpen === p.account.id ? <DueEdit p={p} onDone={() => setDueOpen(null)} /> : null}
          {open === p.account.id ? <Repay d={d} p={p} onDone={() => setOpen(null)} /> : null}
        </li>
      ))}
    </ul>
  );
}

export default function People({ d }: { d: FinanceData }) {
  const all = positions(d).filter((p) => p.balanceRial !== 0 || p.lastDate);
  const mine = all.filter((p) => !p.business);
  const biz = all.filter((p) => p.business);
  const sum = (rows: PersonPosition[], sign: 1 | -1) => rows.reduce((s, p) => s + Math.max(0, sign * p.balanceRial), 0);
  return (
    <Card title="قرض با اشخاص">
      {!all.length ? (
        <Empty art="lend">قرض دادن یا گرفتن از دوست و آشنا را در «تراکنش تازه › قرض» یا با دستیار صوتی («پنج میلیون به علی قرض دادم») ثبت کنید.</Empty>
      ) : null}
      {mine.length ? (
        <>
          <p className="muted small">
            شخصی: طلب شما <Money rial={sum(mine, 1)} short />، بدهی شما <Money rial={sum(mine, -1)} short />
          </p>
          <List d={d} rows={mine} />
        </>
      ) : null}
      {biz.length ? (
        <>
          <h3 className="fin-subhead">کسب‌وکار (از حساب‌های مغازه، جدا از پول شخصی)</h3>
          <p className="muted small">
            طلب کسب‌وکار <Money rial={sum(biz, 1)} short />، بدهی کسب‌وکار <Money rial={sum(biz, -1)} short />
          </p>
          <List d={d} rows={biz} />
        </>
      ) : null}
    </Card>
  );
}
