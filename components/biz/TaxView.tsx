'use client';
import { useState } from 'react';
import { rialToTomanN, tomanToRial } from '@/lib/finance/model';
import type { Business } from '@/lib/biz/model';
import { DEFAULT_EXEMPTION_RIAL, taxEstimate, TAX_BRACKETS, yearFigures } from '@/lib/biz/reports';
import { useFinance } from '../finance/FinanceProvider';
import { Card, Money, parseAmount, TomanInput } from '../finance/kit';
import { fa, WithBiz } from './kit';

const t = (rial: number) => String(Math.round(rialToTomanN(rial)));

function Tax({ b }: { b: Business }) {
  const { update, today } = useFinance();
  const y = yearFigures(b, today);
  const [rev, setRev] = useState(t(y.revenueRial));
  const [cost, setCost] = useState(t(y.costRial));
  const [exp, setExp] = useState(t(y.expensesRial));
  const [extra, setExtra] = useState('0');
  const [ex, setEx] = useState(t(b.taxExemptionRial || DEFAULT_EXEMPTION_RIAL));
  const r = (s: string) => tomanToRial(parseAmount(s) || 0);
  const est = taxEstimate({ revenueRial: r(rev), costRial: r(cost), expensesRial: r(exp), extraRial: r(extra), exemptionRial: r(ex) });
  return (
    <>
      <p className="banner warn">
        برآورد اولیه است، نه اظهارنامه. پله‌ها و معافیت پایه هر سال با قانون بودجه عوض می‌شوند و این‌جا با سال جاری تطبیق داده نشده‌اند: پیش‌فرض‌ها همان عددهای کسب‌آی است. قبل از
        تصمیم، با سامانه مالیاتی یا یک مشاور مالیاتی چک کنید.
      </p>
      <Card title="۱. درآمد و هزینه ۱۲ ماه اخیر">
        <p className="muted small">از فروش و هزینه‌های ثبت‌شده همین‌جا پر شده؛ اگر بخشی از کار بیرون از اپ ثبت شده، عددها را اصلاح کنید.</p>
        <div className="fin-grid">
          <TomanInput label="فروش (بدون ارزش افزوده)" value={rev} onChange={setRev} />
          <TomanInput label="بهای تمام‌شده کالای فروخته‌شده" value={cost} onChange={setCost} />
          <TomanInput label="هزینه‌های قابل قبول" value={exp} onChange={setExp} />
          <TomanInput label="کسورات دیگر (بیمه، استهلاک…)" value={extra} onChange={setExtra} />
          <TomanInput label="معافیت پایه سالانه (ماده ۱۰۱)" value={ex} onChange={setEx} />
          <div className="fin-span">
            <button className="fin-mini" onClick={() => update((dr) => void (dr.biz!.taxExemptionRial = r(ex)))}>
              ذخیره معافیت برای سال بعد
            </button>
          </div>
        </div>
      </Card>
      <Card title="۲. برآورد مالیات">
        <ul className="fin-list">
          <li className="fin-list-row">
            <span>سود خالص</span>
            <Money rial={est.profitRial} />
          </li>
          <li className="fin-list-row">
            <span>مشمول مالیات (بعد از معافیت)</span>
            <Money rial={est.taxableRial} />
          </li>
          {est.steps.map((s, i) => (
            <li key={i} className="fin-list-row">
              <span>
                پله {fa(i + 1)} ({fa(s.rate * 100)}٪ تا {TAX_BRACKETS[i].upToRial === Infinity ? 'بیشتر' : <Money rial={TAX_BRACKETS[i].upToRial} short />})
              </span>
              <Money rial={s.taxRial} />
            </li>
          ))}
          <li className="fin-list-row biz-total">
            <b>مالیات تخمینی سالانه</b>
            <b data-testid="tax-total">
              <Money rial={est.totalRial} />
            </b>
          </li>
        </ul>
        <p className="muted small">نرخ مؤثر: {fa(est.effectivePct, 1)}٪ سود خالص.</p>
      </Card>
      <Card title="۳. راه‌های قانونی کم کردن مالیات">
        <ul className="biz-tips">
          <li>هر هزینه مرتبط با کار که فاکتور دارد (اجاره، حقوق، قبوض، خرید کالا، تبلیغات) سود مشمول را کم می‌کند؛ در «هزینه و سود» و «انبار» کامل ثبت کنید.</li>
          <li>اگر گردش سالانه زیر سقف تبصره ماده ۱۰۰ است، مالیات مقطوع معمولاً ساده‌تر است؛ مبلغش را اداره تعیین می‌کند و این‌جا حساب نمی‌شود.</li>
          <li>معافیت پایه ماده ۱۰۱ را حتماً کم کنید.</li>
          <li>حق بیمه پرداختی و استهلاک تجهیزات جزو کسورات قابل قبول است.</li>
          <li>اظهارنامه را به‌موقع بفرستید؛ جریمه دیرکرد سنگین است.</li>
        </ul>
      </Card>
    </>
  );
}

export default function TaxView() {
  return <WithBiz title="دستیار مالیات" lede="برآورد مالیات سالانه از فروش، بهای تمام‌شده و هزینه‌های ثبت‌شده، با پله‌های ماده ۱۳۱.">{(_d, b) => <Tax b={b} />}</WithBiz>;
}
