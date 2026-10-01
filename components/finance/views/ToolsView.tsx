'use client';
import { useState } from 'react';
import { effectiveAnnualPct, health, impliedAnnualRatePct, khumsRial, loanSchedule, realReturnPct, realValue } from '@/lib/finance/calc';
import { tomanToRial, type FinanceData } from '@/lib/finance/model';
import { isNum } from '@/lib/num';
import { PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card, fmtPctFa, Money, NumInput, parseAmount, TomanInput } from '../kit';

function LoanCalc({ d }: { d: FinanceData }) {
  const { today, items } = useFinance();
  const [amount, setAmount] = useState('200000000');
  const [rate, setRate] = useState('23');
  const [months, setMonths] = useState('36');
  const P = parseAmount(amount);
  const r = parseAmount(rate);
  const n = Math.round(parseAmount(months));
  const ok = P > 0 && r >= 0 && n > 0 && n <= 600;
  const s = ok ? loanSchedule({ principalRial: tomanToRial(P), annualRatePct: r, months: n, firstDueDate: today }) : null;
  const h = health(d, items, today);
  const share = s && h.avgIncomeRial > 0 ? ((s[0].paymentRial + h.monthlyInstallmentsRial) / h.avgIncomeRial) * 100 : null;
  const real = ok ? realReturnPct(effectiveAnnualPct(r), d.settings.inflationPct) : null;
  return (
    <Card title="ماشین‌حساب وام">
      <div className="fin-grid">
        <TomanInput label="مبلغ وام (تومان)" value={amount} onChange={setAmount} />
        <NumInput label="نرخ سود سالانه (٪)" value={rate} onChange={setRate} />
        <NumInput label="تعداد اقساط (ماه)" value={months} onChange={setMonths} />
      </div>
      {s ? (
        <dl className="fin-kpis tight">
          <div className="fin-stat">
            <dt>قسط ماهانه</dt>
            <dd>
              <Money rial={s[0].paymentRial} />
            </dd>
          </div>
          <div className="fin-stat">
            <dt>کل سود پرداختی</dt>
            <dd>
              <Money rial={s.reduce((a, x) => a + x.interestRial, 0)} short />
            </dd>
          </div>
          <div className="fin-stat">
            <dt>هزینه واقعی وام بعد از تورم</dt>
            <dd className={isNum(real) && real < 0 ? 'up' : 'down'}>{fmtPctFa(real, 1)}</dd>
            <dd className="fin-stat-sub">{isNum(real) && real < 0 ? 'تورم بیشتر از سود است؛ پول را ارزان‌تر پس می‌دهید' : 'گران‌تر از تورم'}</dd>
          </div>
          <div className="fin-stat">
            <dt>سهم همه اقساط از درآمد شما</dt>
            <dd className={isNum(share) && share > 40 ? 'down' : ''}>{fmtPctFa(share)}</dd>
            <dd className="fin-stat-sub">{isNum(share) ? (share > 40 ? 'بالای ۴۰٪: پرخطر' : 'با اقساط فعلی') : 'برای این عدد درآمد ثبت کنید'}</dd>
          </div>
        </dl>
      ) : (
        <p className="fin-err">مقادیر را کامل کنید.</p>
      )}
    </Card>
  );
}

function InstallmentOffer() {
  const [cash, setCash] = useState('');
  const [down, setDown] = useState('');
  const [pay, setPay] = useState('');
  const [months, setMonths] = useState('12');
  const rate = impliedAnnualRatePct(parseAmount(cash), parseAmount(down) || 0, parseAmount(pay), Math.round(parseAmount(months)));
  return (
    <Card title="خرید قسطی یا نقدی؟">
      <p className="muted small">فروشنده‌ها معمولاً سود را پنهان می‌کنند («فقط ۱۰٪ گران‌تر»). این‌جا نرخ واقعی پیشنهاد قسطی را ببینید و با سود صندوق یا وام بانکی مقایسه کنید.</p>
      <div className="fin-grid">
        <TomanInput label="قیمت نقدی (تومان)" value={cash} onChange={setCash} />
        <TomanInput label="پیش‌پرداخت (تومان)" value={down} onChange={setDown} placeholder="۰" />
        <TomanInput label="مبلغ هر قسط (تومان)" value={pay} onChange={setPay} />
        <NumInput label="تعداد اقساط ماهانه" value={months} onChange={setMonths} />
      </div>
      {cash && pay ? (
        isNum(rate) ? (
          <p>
            نرخ سود سالانه پنهان در این پیشنهاد: <b>{fmtPctFa(rate, 1)}</b> (مؤثر {fmtPctFa(effectiveAnnualPct(rate), 1)}). اگر کمتر از سود صندوق درآمد ثابت است و پول نقد دارید، قسطی خریدن و
            نگه‌داشتن پول در صندوق به‌صرفه‌تر است.
          </p>
        ) : (
          <p className="fin-err">با این اعداد مجموع اقساط از مبلغ باقی‌مانده کمتر است؛ اعداد را بررسی کنید.</p>
        )
      ) : null}
    </Card>
  );
}

function InflationCalc({ d }: { d: FinanceData }) {
  const [amount, setAmount] = useState('100000000');
  const [years, setYears] = useState('1');
  const [infl, setInfl] = useState(String(d.settings.inflationPct));
  const [ret, setRet] = useState(String(d.settings.safeYieldPct));
  const A = parseAmount(amount);
  const y = parseAmount(years);
  const i = parseAmount(infl);
  const r = parseAmount(ret);
  const ok = A > 0 && y >= 0 && i > -100;
  return (
    <Card title="تورم و بازده واقعی">
      <div className="fin-grid">
        <TomanInput label="مبلغ (تومان)" value={amount} onChange={setAmount} />
        <NumInput label="چند سال" value={years} onChange={setYears} />
        <NumInput label="تورم سالانه (٪)" value={infl} onChange={setInfl} />
        <NumInput label="بازده سالانه سرمایه‌گذاری (٪)" value={ret} onChange={setRet} />
      </div>
      {ok ? (
        <dl className="fin-kpis tight">
          <div className="fin-stat">
            <dt>قدرت خرید این پول بعد از {y.toLocaleString('fa-IR')} سال اگر بماند</dt>
            <dd>
              <Money rial={tomanToRial(realValue(A, y, i))} short />
            </dd>
          </div>
          <div className="fin-stat">
            <dt>برای حفظ قدرت خرید لازم است برسد به</dt>
            <dd>
              <Money rial={tomanToRial(A * (1 + i / 100) ** y)} short />
            </dd>
          </div>
          <div className="fin-stat">
            <dt>با این بازده می‌رسد به</dt>
            <dd>
              <Money rial={tomanToRial(A * (1 + r / 100) ** y)} short />
            </dd>
          </div>
          <div className="fin-stat">
            <dt>بازده واقعی سالانه</dt>
            <dd className={realReturnPct(r, i) < 0 ? 'down' : 'up'}>{fmtPctFa(realReturnPct(r, i), 1)}</dd>
          </div>
        </dl>
      ) : null}
    </Card>
  );
}

function Khums() {
  const [inc, setInc] = useState('');
  const [exp, setExp] = useState('');
  const [prev, setPrev] = useState('');
  const k = khumsRial(tomanToRial(parseAmount(inc) || 0), tomanToRial(parseAmount(exp) || 0), tomanToRial(parseAmount(prev) || 0));
  return (
    <Card title="خمس سالانه (محاسبه ساده)">
      <p className="muted small">یک‌پنجم مازاد درآمد سال خمسی بر هزینه‌های سال. جزئیات (ارث، هدیه، سرمایه کسب، دارایی‌هایی که خمسشان داده شده) را از مرجع خود بپرسید؛ این فقط عدد پایه است.</p>
      <div className="fin-grid">
        <TomanInput label="درآمد سال خمسی (تومان)" value={inc} onChange={setInc} />
        <TomanInput label="هزینه‌های زندگی همان سال (تومان)" value={exp} onChange={setExp} />
        <TomanInput label="مبلغی از مازاد که قبلاً خمسش داده شده (تومان)" value={prev} onChange={setPrev} placeholder="۰" />
      </div>
      {inc ? (
        <p>
          خمس: <b>{<Money rial={k} />}</b>
        </p>
      ) : null}
    </Card>
  );
}

function Tools({ d }: { d: FinanceData }) {
  return (
    <>
      <PageHead title="ماشین‌حساب‌ها">برای تصمیم‌های رایج: گرفتن وام، خرید قسطی، اثر تورم و خمس. عددهای درآمد و اقساط از دفتر خودتان خوانده می‌شود.</PageHead>
      <LoanCalc d={d} />
      <InstallmentOffer />
      <InflationCalc d={d} />
      <Khums />
    </>
  );
}

export default function ToolsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Tools d={d} />}</WithBook>
    </div>
  );
}
