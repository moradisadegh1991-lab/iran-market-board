'use client';
import { useState } from 'react';
import { accountBalances } from '@/lib/finance/calc';
import {
  createFund,
  drawLottery,
  dueFor,
  eligible,
  fundCash,
  giveLoan,
  memberState,
  monthKeyOf,
  monthLabelOf,
  myPosition,
  nextMonth,
  pay,
  paymentsOf,
  undoLoan,
  undoPayment,
} from '@/lib/finance/fund';
import { isMoneyAccount, tomanToRial, type FinanceData, type HomeFund, type MonthKey } from '@/lib/finance/model';
import { Empty, PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Bar, Card, confirmDelete, Disclosure, Money, NumInput, parseAmount, TextInput, TomanInput } from '../kit';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** One member per line; «علی ۲» or «علی ×2» = two shares. */
function parseMembers(text: string): { name: string; shares: number }[] {
  return text
    .split(/\n|،|,/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const latin = l.replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x)));
      const m = latin.match(/^(.*?)[\s×x*]+(\d{1,2})$/);
      return m && m[1].trim() ? { name: m[1].trim(), shares: Math.max(1, +m[2]) } : { name: l, shares: 1 };
    });
}

/** The accounts the user's own money comes from / goes to. */
function MyAccount({ d, value, onChange, label = 'از/به حساب من' }: { d: FinanceData; value: string; onChange: (v: string) => void; label?: string }) {
  const accounts = d.accounts.filter(isMoneyAccount);
  return (
    <label className="fund-acc">
      <span>{label}</span>
      <select className="fin-input sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
const defaultAccount = (d: FinanceData) => (d.accounts.filter(isMoneyAccount).find((a) => a.kind === 'bank') ?? d.accounts.filter(isMoneyAccount)[0])?.id ?? '';

function NewFund({ onDone }: { onDone: (id: string) => void }) {
  const { update, today } = useFinance();
  const [name, setName] = useState('');
  const [share, setShare] = useState('');
  const [loan, setLoan] = useState('');
  const [inst, setInst] = useState('10');
  const [members, setMembers] = useState('');
  const [meName, setMeName] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const list = parseMembers(members);
  return (
    <div className="fin-grid">
      <TextInput label="نام صندوق" value={name} onChange={setName} placeholder="مثلاً صندوق خانوادگی" />
      <TomanInput label="سهم ماهانه هر سهم (تومان)" value={share} onChange={setShare} />
      <TomanInput label="مبلغ هر وام (تومان)" value={loan} onChange={setLoan} />
      <NumInput label="تعداد اقساط وام" value={inst} onChange={setInst} hint="ماهانه، از ماه بعد از گرفتن وام" />
      <label className="fin-field fin-span">
        <span className="fin-label">اعضا — هر نفر یک خط؛ «علی ۲» یعنی دو سهم</span>
        <textarea className="fin-input" rows={4} value={members} onChange={(e) => setMembers(e.target.value)} aria-label="اعضا" />
      </label>
      <label className="fin-field">
        <span className="fin-label">کدام عضو شما هستید؟</span>
        <select className="fin-input" value={meName} onChange={(e) => setMeName(e.target.value)} aria-label="کدام عضو شما هستید؟">
          <option value="">هیچ‌کدام — فقط حساب صندوق را نگه می‌دارم</option>
          {list.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className="fin-span muted small">
        وام‌ها به نوبت یا با قرعه‌کشی داده می‌شوند؛ تا همه یک بار وام نگرفته‌اند، کسی دوباره نمی‌گیرد. سهم و قسط‌های شما به‌صورت انتقال از حسابتان به «صندوق خانگی: …» در دفتر ثبت
        می‌شود — خرج حساب نمی‌شود و دارایی خالص درست می‌ماند.
      </p>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: string | string[] = [];
            update((dr) => {
              r = createFund(
                dr,
                {
                  name,
                  shareRial: tomanToRial(parseAmount(share) || 0),
                  loanRial: tomanToRial(parseAmount(loan) || 0),
                  installments: Math.round(parseAmount(inst) || 0),
                  startMonth: monthKeyOf(today),
                  members: list.map((m) => ({ ...m, me: m.name === meName })),
                },
                today,
              );
            });
            if (Array.isArray(r)) setErrs(r);
            else onDone(r);
          }}
        >
          ساخت صندوق
        </button>
        {errs.length ? <span className="fin-err">{errs.join(' ')}</span> : null}
      </div>
    </div>
  );
}

function MonthBoard({ f, mk, acc }: { f: HomeFund; mk: MonthKey; acc: string }) {
  const { update, today } = useFinance();
  const [err, setErr] = useState<string | null>(null);
  const date = today;
  return (
    <>
      <ul className="fin-list fund-board" aria-label={`پرداخت‌های ${monthLabelOf(mk)}`}>
        {f.members
          .filter((m) => !m.left)
          .map((m) => {
            const due = dueFor(f, m.id, mk);
            const share = paymentsOf(f, m.id, mk, 'share')[0];
            const st = memberState(f, m.id, mk);
            const arrears = st.shareArrearsRial + st.repayArrearsRial;
            return (
              <li key={m.id} data-testid="fund-member">
                <span className="fin-list-main">
                  <b>
                    {m.name}
                    {m.me ? ' (من)' : ''}
                    {m.shares > 1 ? ` (${fa(m.shares)} سهم)` : ''}
                  </b>
                  {arrears > 0 ? (
                    <small className="down">
                      معوقه تا این ماه: <Money rial={arrears} />
                    </small>
                  ) : (
                    <small className="muted">بدون معوقه</small>
                  )}
                </span>
                {due.shareRial ? (
                  <button
                    className={share ? 'fin-mini paid' : 'fin-mini'}
                    aria-pressed={!!share}
                    onClick={() => {
                      let e: string | null = null;
                      update((dr) => {
                        if (share) undoPayment(dr, f.id, share.id);
                        else e = pay(dr, f.id, m.id, mk, 'share', date, m.me ? acc : null);
                      });
                      setErr(e);
                    }}
                  >
                    {share ? '✓ ' : ''}سهم <Money rial={due.shareRial} />
                  </button>
                ) : null}
                {due.repay.map((r) => {
                  const p = paymentsOf(f, m.id, mk, 'repay', r.loanId)[0];
                  return (
                    <button
                      key={r.loanId}
                      className={p ? 'fin-mini paid' : 'fin-mini'}
                      aria-pressed={!!p}
                      onClick={() => {
                        let e: string | null = null;
                        update((dr) => {
                          if (p) undoPayment(dr, f.id, p.id);
                          else e = pay(dr, f.id, m.id, mk, { loanId: r.loanId }, date, m.me ? acc : null);
                        });
                        setErr(e);
                      }}
                    >
                      {p ? '✓ ' : ''}قسط {fa(r.n)} <Money rial={r.rial} />
                    </button>
                  );
                })}
              </li>
            );
          })}
      </ul>
      {err ? <p className="fin-err">{err}</p> : null}
    </>
  );
}

function Loans({ f, mk, acc }: { f: HomeFund; mk: MonthKey; acc: string }) {
  const { update, today } = useFinance();
  const [winner, setWinner] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cash = fundCash(f);
  const el = eligible(f);
  const name = (id: string) => f.members.find((m) => m.id === id)?.name ?? '';
  function give(memberId: string, how: 'lottery' | 'manual') {
    let e: string | null = null;
    update((dr) => {
      e = giveLoan(dr, f.id, memberId, mk, today, how, { accountId: f.members.find((m) => m.id === memberId)?.me ? acc : null });
    });
    setErr(e);
    if (!e) {
      setWinner(null);
      setPick('');
    }
  }
  return (
    <Card title={`وام ${monthLabelOf(mk)}`}>
      <p className="small">
        موجودی صندوق: <Money rial={cash} />، مبلغ وام: <Money rial={f.loanRial} /> در {fa(f.installments)} قسط.{' '}
        {el.length ? (
          <>
            نوبت این دور: {el.map((m) => m.name).join('، ')}.
          </>
        ) : null}
      </p>
      {winner ? (
        <div className="fund-winner" role="status" data-testid="fund-winner">
          <b>قرعه به نام «{name(winner)}» درآمد.</b>
          <button className="btn" onClick={() => give(winner, 'lottery')}>
            ثبت وام برای {name(winner)}
          </button>
          <button className="fin-mini ghost" onClick={() => setWinner(null)}>
            انصراف
          </button>
        </div>
      ) : (
        <div className="fin-actions">
          <button className="btn" disabled={!el.length} onClick={() => setWinner(drawLottery(f)?.id ?? null)}>
            قرعه‌کشی
          </button>
          <select className="fin-input sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="انتخاب دستی گیرنده وام">
            <option value="">یا انتخاب دستی…</option>
            {f.members
              .filter((m) => !m.left)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {el.some((x) => x.id === m.id) ? '' : ' (خارج از نوبت)'}
                </option>
              ))}
          </select>
          {pick ? (
            <button className="fin-mini" onClick={() => give(pick, 'manual')}>
              ثبت وام برای {name(pick)}
            </button>
          ) : null}
        </div>
      )}
      {err ? <p className="fin-err">{err}</p> : null}
      {f.loans.length ? (
        <ul className="fin-list">
          {[...f.loans].reverse().map((l) => {
            const repaid = f.payments.filter((p) => p.loanId === l.id).reduce((s, p) => s + p.rial, 0);
            return (
              <li key={l.id} className="fin-list-block">
                <div className="fin-list-row">
                  <span className="fin-list-main">
                    <b>{name(l.memberId)}</b>
                    <small>
                      {monthLabelOf(l.month)}، {l.how === 'lottery' ? 'قرعه‌کشی' : l.how === 'turn' ? 'نوبت' : 'دستی'}، بازپرداخت <Money rial={repaid} /> از <Money rial={l.rial} />
                    </small>
                  </span>
                  <button
                    className="fin-mini ghost"
                    onClick={() => {
                      let e: string | null = null;
                      if (!confirmDelete(`وام ${name(l.memberId)}`)) return;
                      update((dr) => {
                        e = undoLoan(dr, f.id, l.id);
                      });
                      setErr(e);
                    }}
                  >
                    حذف
                  </button>
                </div>
                <Bar pct={(repaid / l.rial) * 100} tone={repaid >= l.rial ? 'ok' : 'warn'} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

function FundDetail({ d, f }: { d: FinanceData; f: HomeFund }) {
  const { update, today } = useFinance();
  const [mk, setMk] = useState<MonthKey>(monthKeyOf(today));
  const [acc, setAcc] = useState(defaultAccount(d));
  const pos = myPosition(f);
  const bal = f.accountId ? accountBalances(d)[f.accountId] : null;
  const owed = f.loans.reduce((s, l) => s + l.rial, 0) - f.payments.filter((p) => p.kind === 'repay').reduce((s, p) => s + p.rial, 0);
  const arrears = f.members.filter((m) => !m.left).reduce((s, m) => {
    const st = memberState(f, m.id, mk);
    return s + st.shareArrearsRial + st.repayArrearsRial;
  }, 0);
  return (
    <>
      <dl className="fin-kpis">
        <div className="fin-stat">
          <dt>موجودی صندوق</dt>
          <dd>
            <Money rial={fundCash(f)} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>وام‌های پرداخت‌نشده</dt>
          <dd>
            <Money rial={owed} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>معوقه اعضا تا {monthLabelOf(mk)}</dt>
          <dd className={arrears ? 'down' : ''}>
            <Money rial={arrears} short />
          </dd>
        </div>
        {pos ? (
          <div className="fin-stat" data-testid="fund-mine">
            <dt>سهم من در صندوق</dt>
            <dd className={pos.netRial >= 0 ? 'up' : 'down'}>
              <Money rial={bal ?? pos.netRial} short signed />
            </dd>
            <dd className="fin-stat-sub">
              {pos.netRial >= 0 ? 'صندوق به شما بدهکار است' : 'شما به صندوق بدهکارید'}، واریز <Money rial={pos.paidInRial} short />
            </dd>
          </div>
        ) : null}
      </dl>

      <Card
        title={
          <span className="month-nav">
            <button className="fin-mini" onClick={() => setMk(nextMonth(mk, -1))} aria-label="ماه قبل">
              ›
            </button>
            پرداخت‌های {monthLabelOf(mk)}
            <button className="fin-mini" onClick={() => setMk(nextMonth(mk, 1))} aria-label="ماه بعد">
              ‹
            </button>
          </span>
        }
      >
        {pos ? <MyAccount d={d} value={acc} onChange={setAcc} label="پرداخت‌های من از حساب" /> : null}
        <MonthBoard f={f} mk={mk} acc={acc} />
        <p className="muted small">هر دکمه را بزنید تا پرداخت آن ماه ثبت شود؛ دوباره بزنید تا برداشته شود.</p>
      </Card>

      <Loans f={f} mk={mk} acc={acc} />

      <Card title="اعضا">
        <div className="table-scroll">
          <table className="t fin-table">
            <thead>
              <tr>
                <th>عضو</th>
                <th>سهم واریزی</th>
                <th>وام گرفته</th>
                <th>مانده وام</th>
              </tr>
            </thead>
            <tbody>
              {f.members.map((m) => {
                const st = memberState(f, m.id, mk);
                return (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      {m.me ? ' (من)' : ''}
                    </td>
                    <td>
                      <Money rial={st.sharesPaidRial} short />
                    </td>
                    <td>{st.loans ? <Money rial={st.loansRial} short /> : '—'}</td>
                    <td>{st.owedRial ? <Money rial={st.owedRial} short /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          className="fin-mini ghost"
          onClick={() => {
            if (!confirmDelete(`صندوق «${f.name}» (تراکنش‌هایی که در دفتر شما ساخته می‌مانند)`)) return;
            update((dr) => {
              dr.funds = dr.funds.filter((x) => x.id !== f.id);
              const a = dr.accounts.find((x) => x.id === f.accountId);
              if (a) a.archived = true;
            });
          }}
        >
          حذف صندوق
        </button>
      </Card>
    </>
  );
}

function Funds({ d }: { d: FinanceData }) {
  const [sel, setSel] = useState<string | null>(d.funds[0]?.id ?? null);
  const f = d.funds.find((x) => x.id === sel) ?? d.funds[0] ?? null;
  return (
    <>
      <PageHead title="صندوق خانگی">
        صندوق قرض‌الحسنه خانوادگی یا دوستانه: سهم ماهانه هر عضو، وام به نوبت یا قرعه‌کشی، اقساط و معوقه‌ها. همه‌چیز فقط روی همین دستگاه می‌ماند.
      </PageHead>
      {d.funds.length > 1 ? (
        <div className="seg" role="group" aria-label="صندوق‌ها">
          {d.funds.map((x) => (
            <button key={x.id} aria-pressed={x.id === f?.id} onClick={() => setSel(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
      ) : null}
      {f ? (
        <FundDetail d={d} f={f} />
      ) : (
        <Empty art="fund">هنوز صندوقی نساخته‌اید.</Empty>
      )}
      <Card>
        <Disclosure label="+ صندوق تازه" defaultOpen={!d.funds.length}>
          {(close) => (
            <NewFund
              onDone={(id) => {
                setSel(id);
                close();
              }}
            />
          )}
        </Disclosure>
      </Card>
    </>
  );
}

export default function FundView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Funds d={d} />}</WithBook>
    </div>
  );
}
