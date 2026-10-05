'use client';
import Link from 'next/link';
import { useState } from 'react';
import { bookMissing, fixStart, ignoreCheck, monthCheck, openChecks, type BalanceCheck } from '@/lib/finance/balance';
import { monthLabel, monthOf } from '@/lib/finance/calc';
import type { FinanceData } from '@/lib/finance/model';
import { useFinance } from './FinanceProvider';
import { fmtDateFa, Money } from './kit';

const faDigits = (s: string) => s.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);
const whenFa = (date: string, time?: string | null) => `${fmtDateFa(date)}${time ? `، ${faDigits(time)}` : ''}`;
const VIA: Record<string, string> = { sms: 'پیامک بانک', statement: 'گردش حساب', manual: 'موجودی‌ای که خودتان نوشتید' };

/** Where an account's balance comes from (rule 76): the bank's last word, and whether the book agrees with it. */
export function BalanceSource({ d, accountId }: { d: FinanceData; accountId: string }) {
  const a = d.accounts.find((x) => x.id === accountId);
  const c = monthCheck(d, accountId);
  if (!a?.reported || !c) return null;
  const R = a.reported;
  return (
    <span className="bank-balance" data-testid="balance-source">
      <small>
        بر پایه {VIA[R.via] ?? 'بانک'} ({whenFa(R.date, R.time)}): <Money rial={R.rial} />
        {c.diffRial === 0 ? '، با دفتر این ماه می‌خواند ✓' : null}
      </small>
      {c.diffRial !== 0 ? <CheckCard c={c} name={a.name} compact /> : null}
    </span>
  );
}

/** Every open mismatch, for the dashboard. */
export function BalanceChecks({ d }: { d: FinanceData }) {
  const list = openChecks(d);
  if (!list.length) return null;
  return (
    <section className="fin-card balance-checks" aria-label="اختلاف موجودی با بانک" data-testid="balance-checks">
      <h2>موجودی با پیامک بانک نمی‌خواند</h2>
      {list.map((c) => (
        <CheckCard key={c.accountId} c={c} name={d.accounts.find((a) => a.id === c.accountId)?.name ?? ''} />
      ))}
    </section>
  );
}

/** One mismatch: the sum, and the user's answer — the app does not pick a reason. */
function CheckCard({ c, name, compact }: { c: BalanceCheck; name: string; compact?: boolean }) {
  const { data, update } = useFinance();
  const [missing, setMissing] = useState(false);
  const out = c.diffRial < 0;
  const cats = (data?.categories ?? []).filter((x) => x.kind === (out ? 'expense' : 'income'));
  const [cat, setCat] = useState(out ? 'c-other' : 'i-other');
  const [note, setNote] = useState('');
  const a = data?.accounts.find((x) => x.id === c.accountId);
  const ignored = a?.balanceOk && a.balanceOk.key === c.key && a.balanceOk.diffRial === c.diffRial;
  if (ignored && compact) return <small className="muted">اختلاف <Money rial={c.diffRial} signed /> با دفتر — کنار گذاشتید.</small>;
  const month = monthLabel(monthOf(c.monthStart));
  return (
    <div className="check-card" data-testid="balance-check" role="group" aria-label={`اختلاف موجودی ${name}`}>
      {!compact ? <b>{name}</b> : null}
      <dl className="check-sum">
        <dt>{c.startFrom === 'bank' ? `اول ${month} (طبق بانک)` : c.openedInMonth ? 'موجودی اول دوره' : `اول ${month} (از موجودی اول دوره)`}</dt>
        <dd>
          <Money rial={c.startRial} />
        </dd>
        <dt>+ تراکنش‌های ثبت‌شده این ماه ({c.bookedCount.toLocaleString('fa-IR')})</dt>
        <dd>
          <Money rial={c.bookedRial} signed />
        </dd>
        {c.pendingCount ? (
          <>
            <dt>+ در صف «ورود از بانک» ({c.pendingCount.toLocaleString('fa-IR')})</dt>
            <dd>
              <Money rial={c.pendingRial} signed />
            </dd>
          </>
        ) : null}
        <dt>= باید باشد</dt>
        <dd>
          <Money rial={c.expectedRial} />
        </dd>
        <dt>بانک می‌گوید ({whenFa(c.reported.date, c.reported.time)})</dt>
        <dd>
          <Money rial={c.reportedRial} />
        </dd>
        <dt>
          <b>اختلاف</b>
        </dt>
        <dd>
          <Money rial={c.diffRial} signed className={out ? 'down' : 'up'} />
        </dd>
      </dl>
      <p className="small">
        {out ? 'از این حساب پولی رفته که در دفتر نیست' : 'به این حساب پولی آمده که در دفتر نیست'}، یا موجودی اول ماه درست نبوده. کدام است؟ موجودی نشان‌داده‌شده همان مانده بانک است.
      </p>
      {c.pendingCount ? (
        <p className="small">
          {c.pendingCount.toLocaleString('fa-IR')} پیامک این حساب هنوز در صف است
          {c.pendingUnknown ? ` (${c.pendingUnknown.toLocaleString('fa-IR')} تا بی‌جهت — نوعشان را بگویید)` : ''}؛ اگر آن‌ها را ثبت کنید شاید اختلاف برطرف شود.{' '}
          <Link href="/import">صف ورود از بانک ‹</Link>
        </p>
      ) : null}
      {ignored ? (
        <p className="muted small">کنار گذاشتید؛ با مانده تازه بانک دوباره پرسیده می‌شود.</p>
      ) : missing ? (
        <div className="check-missing">
          <label>
            <span>دسته</span>
            <select className="fin-input sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="دسته تراکنش جاافتاده">
              {cats.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.emoji} {x.name}
                </option>
              ))}
            </select>
          </label>
          <input className="fin-input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="بابت (اختیاری)" aria-label="بابت" />
          <button className="btn" onClick={() => update((dr) => void bookMissing(dr, c.accountId, { categoryId: cat, note }))}>
            ثبت {out ? 'هزینه' : 'درآمد'} <Money rial={Math.abs(c.diffRial)} />
          </button>
          <button className="fin-mini ghost" onClick={() => setMissing(false)}>
            انصراف
          </button>
        </div>
      ) : (
        <div className="check-answers" role="group" aria-label="جواب">
          <button className="fin-mini" onClick={() => setMissing(true)}>
            یک {out ? 'هزینه' : 'درآمد'} ثبت نشده
          </button>
          {c.startFrom === 'opening' ? (
            <button
              className="fin-mini"
              onClick={() => {
                if (window.confirm(`موجودی اول دوره «${name}» به اندازه اختلاف اصلاح شود؟ تراکنش‌ها دست نمی‌خورند.`)) update((dr) => void fixStart(dr, c.accountId));
              }}
            >
              موجودی اول ماه اشتباه بود
            </button>
          ) : null}
          <button className="fin-mini ghost" onClick={() => update((dr) => ignoreCheck(dr, c.accountId))}>
            نادیده بگیر
          </button>
        </div>
      )}
    </div>
  );
}
