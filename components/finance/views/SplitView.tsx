'use client';
import { useState } from 'react';
import { addExpense, createGroup, deleteExpense, linkCandidates, netOf, settle, settleUp, undoSettlement } from '@/lib/finance/split';
import { isMoneyAccount, tomanToRial, type FinanceData, type SplitExpense, type SplitGroup } from '@/lib/finance/model';
import { Empty, PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card, confirmDelete, Disclosure, fmtDateFa, JalaliDate, Money, parseAmount, TextInput, TomanInput } from '../kit';

const defaultAccount = (d: FinanceData) => (d.accounts.filter(isMoneyAccount).find((a) => a.kind === 'bank') ?? d.accounts.filter(isMoneyAccount)[0])?.id ?? '';
const MODE: Record<SplitExpense['mode'], string> = { equal: 'مساوی', shares: 'به نسبت', exact: 'مبلغ دقیق' };

function NewGroup({ onDone }: { onDone: (id: string) => void }) {
  const { update, today } = useFinance();
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [meName, setMeName] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const list = members
    .split(/\n|،|,/)
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <div className="fin-grid">
      <TextInput label="نام گروه" value={name} onChange={setName} placeholder="مثلاً سفر شمال، خانه مشترک" />
      <label className="fin-field fin-span">
        <span className="fin-label">اعضا — هر نفر یک خط (خودتان هم)</span>
        <textarea className="fin-input" rows={4} value={members} onChange={(e) => setMembers(e.target.value)} aria-label="اعضای گروه" />
      </label>
      <label className="fin-field">
        <span className="fin-label">کدام عضو شما هستید؟</span>
        <select className="fin-input" value={meName} onChange={(e) => setMeName(e.target.value)} aria-label="کدام عضو شما هستید؟">
          <option value="">هیچ‌کدام — فقط حساب گروه را نگه می‌دارم</option>
          {list.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: string | string[] = [];
            update((dr) => {
              r = createGroup(dr, name, list.map((m) => ({ name: m, me: m === meName })), today);
            });
            if (Array.isArray(r)) setErrs(r);
            else onDone(r);
          }}
        >
          ساخت گروه
        </button>
        {errs.length ? <span className="fin-err">{errs.join(' ')}</span> : null}
      </div>
    </div>
  );
}

function AddExpense({ d, g, onDone }: { d: FinanceData; g: SplitGroup; onDone: () => void }) {
  const { update, today } = useFinance();
  const me = g.members.find((m) => m.me);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [paidBy, setPaidBy] = useState(me?.id ?? g.members[0].id);
  const [mode, setMode] = useState<SplitExpense['mode']>('equal');
  const [among, setAmong] = useState<string[]>(g.members.map((m) => m.id));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [cat, setCat] = useState('c-food');
  const [acc, setAcc] = useState(defaultAccount(d));
  const [link, setLink] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const rial = tomanToRial(parseAmount(amount) || 0);
  const cands = me && paidBy === me.id && rial > 0 ? linkCandidates(d, rial, date) : [];
  const cats = d.categories.filter((c) => c.kind === 'expense');
  return (
    <div className="fin-grid">
      <TextInput label="بابت" value={title} onChange={setTitle} placeholder="مثلاً شام، بنزین، اجاره ویلا" />
      <TomanInput value={amount} onChange={setAmount} />
      <JalaliDate label="تاریخ" value={date} onChange={setDate} />
      <label className="fin-field">
        <span className="fin-label">چه کسی پرداخت کرد؟</span>
        <select className="fin-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} aria-label="پرداخت‌کننده">
          {g.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.me ? ' (من)' : ''}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="fin-span split-among">
        <legend>
          سهم‌ها:{' '}
          {(Object.keys(MODE) as SplitExpense['mode'][]).map((k) => (
            <label key={k} className="split-mode">
              <input type="radio" name={`mode-${g.id}`} checked={mode === k} onChange={() => setMode(k)} /> {MODE[k]}
            </label>
          ))}
        </legend>
        {g.members.map((m) => (
          <label key={m.id} className="split-row">
            <input
              type="checkbox"
              checked={among.includes(m.id)}
              onChange={(e) => setAmong((a) => (e.target.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))}
              aria-label={`سهم ${m.name}`}
            />
            <span>
              {m.name}
              {m.me ? ' (من)' : ''}
            </span>
            {mode !== 'equal' && among.includes(m.id) ? (
              <input
                className="fin-input sm"
                inputMode="decimal"
                dir="ltr"
                value={vals[m.id] ?? ''}
                placeholder={mode === 'shares' ? '۱' : 'تومان'}
                onChange={(e) => setVals((v) => ({ ...v, [m.id]: e.target.value }))}
                aria-label={mode === 'shares' ? `نسبت ${m.name}` : `مبلغ ${m.name} (تومان)`}
              />
            ) : null}
          </label>
        ))}
      </fieldset>
      {me && among.includes(me.id) ? (
        <label className="fin-field">
          <span className="fin-label">دسته سهم من</span>
          <select className="fin-input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="دسته سهم من">
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {me && paidBy === me.id ? (
        cands.length ? (
          <label className="fin-field fin-span">
            <span className="fin-label">این پرداخت قبلاً در دفتر ثبت شده (مثلاً از پیامک بانک)؟</span>
            <select className="fin-input" value={link} onChange={(e) => setLink(e.target.value)} aria-label="تراکنش ثبت‌شده">
              <option value="">نه — از حساب انتخابی ثبت کن</option>
              {cands.map((t) => (
                <option key={t.id} value={t.id}>
                  {fmtDateFa(t.date)}، {d.accounts.find((a) => a.id === t.accountId)?.name}، {t.note || 'بدون شرح'}
                </option>
              ))}
            </select>
          </label>
        ) : null
      ) : null}
      {me && paidBy === me.id && !link ? (
        <label className="fin-field">
          <span className="fin-label">از حساب</span>
          <select className="fin-input" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="از حساب">
            {d.accounts.filter(isMoneyAccount).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            let r: string | string[] = [];
            const order = g.members.map((m) => m.id).filter((id) => among.includes(id));
            update((dr) => {
              r = addExpense(
                dr,
                g.id,
                {
                  date,
                  title,
                  amountRial: rial,
                  paidBy,
                  mode,
                  among: order,
                  values: mode === 'equal' ? undefined : order.map((id) => (mode === 'exact' ? tomanToRial(parseAmount(vals[id] ?? '') || 0) : parseAmount(vals[id] ?? '') || 1)),
                  categoryId: cat,
                },
                { accountId: link ? null : acc, linkTxnId: link || null },
              );
            });
            if (Array.isArray(r)) setErrs(r);
            else {
              setErrs([]);
              setTitle('');
              setAmount('');
              setVals({});
              setLink('');
              onDone();
            }
          }}
        >
          ثبت خرج
        </button>
        {errs.length ? <span className="fin-err">{errs.join(' ')}</span> : null}
      </div>
    </div>
  );
}

function GroupDetail({ d, g }: { d: FinanceData; g: SplitGroup }) {
  const { update, today } = useFinance();
  const [acc, setAcc] = useState(defaultAccount(d));
  const net = netOf(g);
  const plan = settleUp(g);
  const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? '';
  const me = g.members.find((m) => m.me);
  const total = g.expenses.reduce((s, e) => s + e.amountRial, 0);
  return (
    <>
      <Card title={`حساب «${g.name}»`}>
        <p className="small">
          جمع خرج‌ها: <Money rial={total} />، {g.expenses.length.toLocaleString('fa-IR')} خرج
        </p>
        <ul className="fin-list" aria-label="طلب و بدهی اعضا">
          {g.members.map((m) => (
            <li key={m.id} data-testid="split-net">
              <span className="fin-list-main">
                <b>
                  {m.name}
                  {m.me ? ' (من)' : ''}
                </b>
                <small>{net[m.id] > 0 ? 'طلبکار' : net[m.id] < 0 ? 'بدهکار' : 'تسویه'}</small>
              </span>
              <Money rial={net[m.id]} signed className={net[m.id] > 0 ? 'up' : net[m.id] < 0 ? 'down' : ''} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title="تسویه با کمترین پرداخت">
        {plan.length ? (
          <>
            {me && plan.some((p) => p.from === me.id || p.to === me.id) ? (
              <label className="fund-acc">
                <span>پرداخت/دریافت من از حساب</span>
                <select className="fin-input sm" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="حساب تسویه">
                  {d.accounts.filter(isMoneyAccount).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ul className="fin-list">
              {plan.map((p) => (
                <li key={`${p.from}-${p.to}`} data-testid="split-plan">
                  <span className="fin-list-main">
                    <b>
                      {name(p.from)} ← به {name(p.to)}
                    </b>
                  </span>
                  <Money rial={p.rial} />
                  <button className="fin-mini" onClick={() => update((dr) => void settle(dr, g.id, p.from, p.to, p.rial, today, acc))}>
                    پرداخت شد
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty>همه با هم حساب‌اند.</Empty>
        )}
        {g.settlements.length ? (
          <details>
            <summary className="small">تسویه‌های ثبت‌شده ({g.settlements.length.toLocaleString('fa-IR')})</summary>
            <ul className="fin-list">
              {[...g.settlements].reverse().map((s) => (
                <li key={s.id}>
                  <span className="fin-list-main">
                    <b>
                      {name(s.from)} ← به {name(s.to)}
                    </b>
                    <small>{fmtDateFa(s.date)}</small>
                  </span>
                  <Money rial={s.rial} />
                  <button className="fin-mini ghost" onClick={() => update((dr) => undoSettlement(dr, g.id, s.id))}>
                    حذف
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card title="خرج‌ها">
        <Disclosure label="+ خرج تازه" defaultOpen={!g.expenses.length}>
          {(close) => <AddExpense d={d} g={g} onDone={close} />}
        </Disclosure>
        {g.expenses.length ? (
          <ul className="fin-list">
            {[...g.expenses].reverse().map((e) => (
              <li key={e.id} data-testid="split-expense">
                <span className="fin-list-main">
                  <b>{e.title}</b>
                  <small>
                    {fmtDateFa(e.date)}، پرداخت: {name(e.paidBy)}، {MODE[e.mode]} بین {e.shares.map((s) => name(s.memberId)).join('، ')}
                  </small>
                </span>
                <Money rial={e.amountRial} />
                <button className="fin-mini ghost" onClick={() => confirmDelete(`خرج «${e.title}»`) && update((dr) => deleteExpense(dr, g.id, e.id))}>
                  حذف
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <button
        className="fin-mini ghost"
        onClick={() => {
          if (!confirmDelete(`گروه «${g.name}» (تراکنش‌هایی که در دفتر شما ساخته می‌مانند)`)) return;
          update((dr) => {
            dr.splitGroups = dr.splitGroups.filter((x) => x.id !== g.id);
            const a = dr.accounts.find((x) => x.id === g.accountId);
            if (a) a.archived = true;
          });
        }}
      >
        حذف گروه
      </button>
    </>
  );
}

function Groups({ d }: { d: FinanceData }) {
  const [sel, setSel] = useState<string | null>(d.splitGroups[0]?.id ?? null);
  const g = d.splitGroups.find((x) => x.id === sel) ?? d.splitGroups[0] ?? null;
  return (
    <>
      <PageHead title="دنگ و خرج گروهی">
        سفر، خانه مشترک یا دورهمی: هر خرج را کسی پرداخت می‌کند و بین چند نفر تقسیم می‌شود؛ اپ می‌گوید چه کسی به چه کسی چقدر بدهکار است و با کمترین تعداد پرداخت تسویه می‌کند. در دفتر شما
        فقط سهم خودتان خرج حساب می‌شود و بقیه طلب یا بدهی است.
      </PageHead>
      {d.splitGroups.length > 1 ? (
        <div className="seg" role="group" aria-label="گروه‌ها">
          {d.splitGroups.map((x) => (
            <button key={x.id} aria-pressed={x.id === g?.id} onClick={() => setSel(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
      ) : null}
      {g ? <GroupDetail d={d} g={g} /> : <Empty>هنوز گروهی نساخته‌اید.</Empty>}
      <Card>
        <Disclosure label="+ گروه تازه" defaultOpen={!d.splitGroups.length}>
          {(close) => (
            <NewGroup
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

export default function SplitView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Groups d={d} />}</WithBook>
    </div>
  );
}
