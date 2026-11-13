'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { liquidityPlan } from '@/lib/finance/planning';
import type { FinanceData } from '@/lib/finance/model';
import { useFinance } from './FinanceProvider';
import { Card, fmtDateFa, fmtToman, Money, Stat } from './kit';

export default function CashPlan({ d }: { d: FinanceData }) {
  const { today } = useFinance();
  const [days, setDays] = useState<30 | 90>(30);
  const [includeExpected, setIncludeExpected] = useState(false);
  const p = useMemo(() => liquidityPlan(d, today, days, includeExpected), [d, today, days, includeExpected]);
  const min = Math.min(0, p.startRial, p.low.balanceRial);
  const max = Math.max(1, p.startRial, ...p.points.map((x) => x.balanceRial));
  const y = (v: number) => 114 - ((v - min) / (max - min)) * 100;
  const path = p.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${12 + (i / days) * 576},${y(v.balanceRial)}`).join(' ');
  return (
    <section className="cash-plan" aria-label="برنامه نقدینگی" data-testid="cash-plan">
      <Card title="پول من تا کجا می‌رسد؟" action={<Link href="/accounts" className="tag link">بررسی حساب‌ها</Link>}>
        <p className="muted small">موجودی شخصی، تعهدات ثبت‌شده و برآورد خرج روزمره را کنار هم ببینید.</p>
        <div className="cash-controls">
          <div className="cash-period" role="group" aria-label="بازه برنامه">
            {([30, 90] as const).map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n.toLocaleString('fa-IR')} روز آینده</button>)}
          </div>
          <label className="cash-scenario"><input type="checkbox" checked={includeExpected} onChange={(e) => setIncludeExpected(e.target.checked)} /> دریافت‌های آینده هم حساب شوند</label>
        </div>
        <div className="cash-result" aria-live="polite" aria-atomic="true">
          <span className="cash-eyebrow">{includeExpected ? 'سناریوی دریافت به‌موقع' : 'سناریوی محافظه‌کارانه · بدون دریافت جدید'}</span>
          <h2 className={p.firstShortfall ? 'down' : ''}>
            {!p.cashAccountCount || (p.startRial === 0 && !d.txns.length && !p.obligationsRial && !p.expectedRial) ? 'اول موجودی حساب شخصی را ثبت کنید' : p.firstShortfall ? <>احتمال کسری از {fmtDateFa(p.firstShortfall.date)}</> : 'در این سناریو کسری دیده نمی‌شود'}
          </h2>
          <p>کمترین مانده: <Money rial={p.low.balanceRial} /> در {fmtDateFa(p.low.date)}؛ {p.firstShortfall ? <>برای پوشش کسری تا پایان بازه، دست‌کم <Money rial={-p.low.balanceRial} /> نقدینگی بیشتر لازم است.</> : 'این عدد فقط بر اساس اطلاعات ثبت‌شده است.'}</p>
        </div>
        <dl className="fin-kpis tight cash-stats">
          <Stat label="موجودی قابل پرداخت امروز" sub="بانک، نقد و کیف پول شخصی"><Money rial={p.startRial} short /></Stat>
          <Stat label="پرداخت‌های پیش رو" sub="شامل بدهی‌های سررسیدگذشته"><Money rial={p.obligationsRial} short /></Stat>
          <Stat label="برآورد خرج روزانه" sub={p.basisDays ? `سابقه: ${p.basisDays.toLocaleString('fa-IR')} روز` : 'سابقه هزینه‌ای ثبت نشده'}><Money rial={p.dailyRial} short /></Stat>
          <Stat label="مانده در پایان بازه" sub={fmtDateFa(p.points[days].date)}><Money rial={p.endRial} short signed /></Stat>
        </dl>
        <figure className="cash-chart">
          <svg viewBox="0 0 600 132" role="img" aria-label={`مسیر برآورد نقدینگی؛ شروع ${fmtToman(p.startRial)}، کمترین مانده ${fmtToman(p.low.balanceRial)}، پایان ${fmtToman(p.endRial)}`}>
            <line x1="12" x2="588" y1={y(0)} y2={y(0)} className="cash-zero" />
            <path d={path} className="cash-line" />
            <circle cx="588" cy={y(p.endRial)} r="4" className="cash-dot" />
          </svg>
          <figcaption><span>امروز</span><span>خط‌چین: موجودی صفر</span><span>{fmtDateFa(p.points[days].date)}</span></figcaption>
        </figure>
        {p.basisDays < 30 ? <p className="note">دادهٔ هزینه کمتر از ۳۰ روز است؛ برآورد خرج روزمره ممکن است کمتر از واقع باشد. تراکنش‌های قبلی را وارد کنید.</p> : null}
        {p.overdueReceiptsRial > 0 ? <p className="note">دریافت عقب‌افتاده: <Money rial={p.overdueReceiptsRial} />؛ تا ثبت دریافت، در هیچ سناریویی قابل خرج محسوب نمی‌شود.</p> : null}
        <details className="cash-details">
          <summary>فرض‌ها و جزئیات محاسبه</summary>
          <p>فروش طلا، ارز و سایر سرمایه‌ها، برداشت از صندوق، کیف صرافی، طلب‌ها و پول کسب‌وکار در موجودی امروز نیست. انتقال آن‌ها به حساب شخصی باید ثبت شود. مجموع حساب‌ها بررسی می‌شود؛ موجودی حساب صادرکنندهٔ چک را جداگانه کنترل کنید.</p>
          <p>خرج روزانه از هزینه‌های شخصی بدون اتصال به قسط، چک و قبض، در حداکثر ۹۰ روز گذشته محاسبه می‌شود؛ سابقه کوتاه بر حداقل ۳۰ روز تقسیم می‌شود. پرداخت‌های ثبت‌شدهٔ سررسیدگذشته امروز کسر می‌شوند. رشد هزینه‌ها، سود سرمایه‌گذاری و هدف‌های پس‌انداز در این برآورد منظور نشده‌اند.</p>
          <p>دریافت‌های آیندهٔ ثبت‌شده: <Money rial={p.expectedRial} />. با روشن کردن گزینه، فقط دریافت‌های امروز و آینده در تاریخ سررسید اضافه می‌شوند؛ وصول آن‌ها قطعی نیست.</p>
          <div className="table-scroll"><table className="fin-table"><caption>مانده برآوردی روزانه (تومان)</caption><thead><tr><th scope="col">تاریخ</th><th scope="col">مانده</th></tr></thead><tbody>{p.points.map((point) => <tr key={point.date}><td>{fmtDateFa(point.date)}</td><td><Money rial={point.balanceRial} /></td></tr>)}</tbody></table></div>
        </details>
        <nav className="cash-actions" aria-label="اقدامات برنامه مالی">
          <Link href="/transactions" className="btn">ثبت خرج و درآمد</Link>
          <Link href="/debts">بررسی تعهدات</Link>
          <Link href="/budget">تنظیم بودجه</Link>
          <Link href="/settings">پشتیبان‌گیری از دفتر</Link>
        </nav>
      </Card>
    </section>
  );
}
