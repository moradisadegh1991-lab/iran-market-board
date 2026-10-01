'use client';
import Link from 'next/link';
import { budgetStatus, cashForecast, goalPlan, health, monthLabel, monthOf, monthTotals, netWorth, upcoming } from '@/lib/finance/calc';
import type { FinanceData } from '@/lib/finance/model';
import { isNum } from '@/lib/num';
import { PageHead } from '../../ui';
import DueList from '../DueList';
import { useFinance, WithBook } from '../FinanceProvider';
import { Bar, Card, fmtDateFa, fmtPctFa, Money, Stat } from '../kit';
import TxnForm from '../TxnForm';

export const QUICK_QUESTIONS = [
  'وضعیت مالی این ماهم را خلاصه کن؛ کجا باید خرجم را کم کنم؟',
  'پس‌اندازم را طلا بخرم، دلار، یا صندوق درآمد ثابت؟',
  'وام بگیرم یا نه؟ با قسط فعلی‌ام چقدر جا دارم؟',
  'برای رسیدن به هدف‌هایم ماهی چقدر باید کنار بگذارم؟',
];

interface Alert {
  tone: 'bad' | 'warn';
  text: string;
  href: string;
}

function alerts(d: FinanceData, items: ReturnType<typeof useFinance>['items'], today: string): Alert[] {
  const out: Alert[] = [];
  const dues = upcoming(d, today, 30);
  const overdue = dues.filter((x) => x.overdue);
  if (overdue.length) out.push({ tone: 'bad', text: `${overdue.length.toLocaleString('fa-IR')} قسط/چک/قبض سررسید گذشته و ثبت‌نشده دارید.`, href: '/debts' });
  if (d.inbox.length) out.push({ tone: 'warn', text: `${d.inbox.length.toLocaleString('fa-IR')} تراکنش از گردش حساب یا پیامک منتظر تأیید شماست؛ تا تأیید نشوند در مانده‌ها حساب نمی‌شوند.`, href: '/import' });
  const fc = cashForecast(d, today, 30);
  if (fc.low.balanceRial < 0)
    out.push({ tone: 'bad', text: `با تعهدات ثبت‌شده، موجودی نقد شما در ${fmtDateFa(fc.low.date)} منفی می‌شود. اگر چک صادره دارید، قبل از آن تاریخ پول جابه‌جا کنید.`, href: '/debts' });
  for (const b of budgetStatus(d, monthOf(today), today)) {
    const name = d.categories.find((c) => c.id === b.categoryId)?.name ?? '';
    if (b.status === 'over') out.push({ tone: 'bad', text: `بودجه «${name}» این ماه ${fmtPctFa(b.usedPct - 100)} رد شده.`, href: '/budget' });
    else if (b.status === 'hot') out.push({ tone: 'warn', text: `خرج «${name}» از سرعت ماه جلوتر است (${fmtPctFa(b.usedPct)} مصرف، ${fmtPctFa(b.pacePct)} از ماه گذشته).`, href: '/budget' });
  }
  const h = health(d, items, today);
  if (isNum(h.emergencyMonths) && h.emergencyMonths < d.settings.emergencyMonths)
    out.push({ tone: 'warn', text: `پول در دسترس شما ${h.emergencyMonths.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ماه خرج را پوشش می‌دهد؛ هدف ${d.settings.emergencyMonths.toLocaleString('fa-IR')} ماه است.`, href: '/accounts' });
  if (isNum(h.debtServicePct) && h.debtServicePct > 40)
    out.push({ tone: 'bad', text: `اقساط ${fmtPctFa(h.debtServicePct)} درآمد ماهانه را می‌برند؛ بالای ۴۰٪ پرخطر است.`, href: '/debts' });
  return out;
}

function Onboarding() {
  return (
    <Card title="شروع در چهار قدم">
      <ol className="fin-steps">
        <li>
          <Link href="/accounts">حساب‌ها</Link> را با موجودی امروزشان بسازید (بانک، نقد، صندوق) و طلا/ارز/خودرو را به‌عنوان دارایی اضافه کنید.
        </li>
        <li>
          هر خرج و درآمد را در <Link href="/transactions">تراکنش‌ها</Link> ثبت کنید؛ از همین صفحه هم می‌شود.
        </li>
        <li>
          وام‌ها، چک‌ها و قبض‌های ماهانه را در <Link href="/debts">وام، چک و قبض</Link> وارد کنید تا سررسیدها یادتان نرود.
        </li>
        <li>
          برای هر دسته <Link href="/budget">بودجه</Link> بگذارید و از <Link href="/advisor">مشاور</Link> بپرسید.
        </li>
      </ol>
      <p className="note">همه‌چیز فقط در همین مرورگر ذخیره می‌شود. از صفحه «حساب و دارایی» فایل پشتیبان بگیرید.</p>
    </Card>
  );
}

function Home({ d }: { d: FinanceData }) {
  const { today, items } = useFinance();
  const m = monthOf(today);
  const t = monthTotals(d, m);
  const nw = netWorth(d, items, today);
  const al = alerts(d, items, today);
  const budgets = budgetStatus(d, m, today).slice(0, 5);
  const fresh = !d.txns.length && !d.loans.length && !d.assets.length && d.accounts.every((a) => a.openingRial === 0);

  return (
    <>
      <PageHead title="داشبورد مالی">
        {fmtDateFa(today)} — همه مبالغ به تومان. قیمت طلا، سکه و ارزِ دارایی‌ها از تابلوی زنده بازار گرفته می‌شود.
      </PageHead>

      {fresh ? <Onboarding /> : null}

      <dl className="fin-kpis">
        <Stat label="دارایی خالص" sub={nw.unpriced.length ? `بدون قیمت: ${nw.unpriced.join('، ')}` : 'دارایی‌ها + طلب − بدهی'}>
          <Money rial={nw.netRial} short />
        </Stat>
        <Stat label="پول در دسترس" sub="حساب‌ها + دارایی نقدشونده">
          <Money rial={nw.liquidRial} short />
        </Stat>
        <Stat label={`درآمد ${monthLabel(m)}`}>
          <Money rial={t.incomeRial} short />
        </Stat>
        <Stat label={`خرج ${monthLabel(m)}`}>
          <Money rial={t.expenseRial} short />
        </Stat>
        <Stat label="نرخ پس‌انداز این ماه" sub="سهم درآمدی که ماند">
          <span className={isNum(t.savingsRatePct) ? (t.savingsRatePct >= 0 ? 'up' : 'down') : ''}>{fmtPctFa(t.savingsRatePct)}</span>
        </Stat>
      </dl>

      {al.length ? (
        <ul className="fin-alerts" aria-label="هشدارها">
          {al.map((a, i) => (
            <li key={i} className={a.tone}>
              <Link href={a.href}>{a.text}</Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="fin-cols">
        <Card title="ثبت سریع تراکنش">
          <TxnForm data={d} compact />
        </Card>
        <Card title="۳۰ روز آینده" action={<Link href="/debts" className="tag link">همه</Link>}>
          <DueList data={d} limit={6} />
        </Card>
      </div>

      <div className="fin-cols">
        <Card title={`بودجه ${monthLabel(m)}`} action={<Link href="/budget" className="tag link">ویرایش</Link>}>
          {budgets.length ? (
            <ul className="fin-budget">
              {budgets.map((b) => {
                const c = d.categories.find((x) => x.id === b.categoryId);
                return (
                  <li key={b.categoryId}>
                    <span>
                      {c?.emoji} {c?.name}
                    </span>
                    <Bar pct={b.usedPct} tone={b.status === 'over' ? 'bad' : b.status === 'hot' ? 'warn' : 'ok'} marker={b.pacePct} />
                    <small>
                      <Money rial={b.spentRial} short /> از <Money rial={b.limitRial} short />
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">هنوز بودجه‌ای تعیین نشده.</p>
          )}
        </Card>
        <Card title="اهداف" action={<Link href="/goals" className="tag link">همه</Link>}>
          {d.goals.length ? (
            <ul className="fin-budget">
              {d.goals.slice(0, 4).map((g) => {
                const p = goalPlan(g, today, d.settings.inflationPct, d.settings.safeYieldPct);
                return (
                  <li key={g.id}>
                    <span>{g.name}</span>
                    <Bar pct={p.progressPct} tone={p.reached ? 'ok' : 'warn'} />
                    <small>
                      ماهانه <Money rial={p.monthlyAtSafeYieldRial} short />
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">هدفی مثل خرید خانه، خودرو یا صندوق اضطراری تعریف کنید.</p>
          )}
        </Card>
      </div>

      <Card title="از مشاور بپرسید">
        <p className="muted small">مشاور (Claude) خلاصه اعداد شما را می‌بیند — نه یادداشت‌ها و نه نام طرف چک‌ها — و با قیمت‌های امروز بازار جواب می‌دهد.</p>
        <div className="fin-quick">
          {QUICK_QUESTIONS.map((q) => (
            <Link key={q} href={`/advisor?q=${encodeURIComponent(q)}`} className="fin-chip">
              {q}
            </Link>
          ))}
        </div>
      </Card>

    </>
  );
}

export default function HomeView() {
  return <div className="wrap">{<WithBook>{(d) => <Home d={d} />}</WithBook>}</div>;
}
