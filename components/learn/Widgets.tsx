'use client';
import { useState } from 'react';
import { health } from '@/lib/finance/calc';
import { compound, doublingYears, inflate, mixVol, positionSize, split503020, workHours } from '@/lib/learn/calc';
import { realReturnPct } from '@/lib/finance/calc';
import type { WidgetKey } from '@/lib/learn/lessons';
import { isNum } from '@/lib/num';
import { useFinance } from '../finance/FinanceProvider';
import { fmtPctFa, Money, NumInput, parseAmount, TomanInput } from '../finance/kit';

// Small calculators inside lessons. Where the user's own book has the number (income, spending,
// inflation setting), it is the starting value — the lesson is about their money, not an example.
// Amounts typed here are toman; <Money> takes rial.

const T = (toman: number) => toman * 10;
const yearsFa = (y: number) => (Number.isFinite(y) ? `${y.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} سال` : '—');

function Out({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="fin-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {sub ? <dd className="fin-stat-sub">{sub}</dd> : null}
    </div>
  );
}

function useBook() {
  const { data, items, today } = useFinance();
  const h = data ? health(data, items, today) : null;
  return {
    inflation: data?.settings.inflationPct ?? 40,
    safeYield: data?.settings.safeYieldPct ?? 30,
    income: h && h.avgIncomeRial > 0 ? Math.round(h.avgIncomeRial / 10) : null,
    expense: h && h.avgExpenseRial > 0 ? Math.round(h.avgExpenseRial / 10) : null,
    h,
  };
}

function Budget() {
  const b = useBook();
  const [inc, setInc] = useState(String(b.income ?? 30_000_000));
  const v = parseAmount(inc);
  const s = isNum(v) && v > 0 ? split503020(v) : null;
  return (
    <>
      <div className="fin-grid">
        <TomanInput label="درآمد ماهانه (تومان)" value={inc} onChange={setInc} />
      </div>
      {s ? (
        <dl className="fin-kpis tight">
          <Out label="۵۰٪ نیازها">
            <Money rial={T(s.needs)} short />
          </Out>
          <Out label="۳۰٪ خواسته‌ها">
            <Money rial={T(s.wants)} short />
          </Out>
          <Out label="۲۰٪ پس‌انداز" sub={isNum(b.h?.savingsRatePct) ? `نرخ پس‌انداز شما در دفتر: ${fmtPctFa(b.h!.savingsRatePct)}` : 'با ثبت درآمد و خرج، نرخ پس‌انداز خودتان این‌جا می‌آید'}>
            <Money rial={T(s.save)} short />
          </Out>
        </dl>
      ) : null}
    </>
  );
}

function Emergency() {
  const b = useBook();
  const [exp, setExp] = useState(String(b.expense ?? 20_000_000));
  const v = parseAmount(exp);
  const mine = b.h?.emergencyMonths;
  return (
    <>
      <div className="fin-grid">
        <TomanInput label="خرج ماهانه (تومان)" value={exp} onChange={setExp} />
      </div>
      {isNum(v) && v > 0 ? (
        <dl className="fin-kpis tight">
          <Out label="هدف ۳ ماهه">
            <Money rial={T(v * 3)} short />
          </Out>
          <Out label="هدف ۶ ماهه">
            <Money rial={T(v * 6)} short />
          </Out>
          <Out label="پول نقدشونده شما" sub={isNum(mine) ? (mine >= 3 ? 'در محدوده امن' : 'زیر ۳ ماه') : 'از دفتر شما حساب می‌شود'}>
            {isNum(mine) ? `${mine.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ماه خرج` : '—'}
          </Out>
        </dl>
      ) : null}
      {b.expense ? <p className="muted small">خرج ماهانه از میانگین ثبت‌شده در دفتر شما آمده؛ عوضش کنید تا حالت‌های دیگر را ببینید.</p> : null}
    </>
  );
}

function Hours() {
  const b = useBook();
  const [inc, setInc] = useState(String(b.income ?? 30_000_000));
  const [hrs, setHrs] = useState('176');
  const [price, setPrice] = useState('8000000');
  const x = workHours(parseAmount(price), parseAmount(inc), parseAmount(hrs));
  return (
    <>
      <div className="fin-grid">
        <TomanInput label="درآمد ماهانه (تومان)" value={inc} onChange={setInc} />
        <NumInput label="ساعت کار در ماه" value={hrs} onChange={setHrs} />
        <TomanInput label="قیمت چیزی که می‌خواهید (تومان)" value={price} onChange={setPrice} />
      </div>
      {isNum(x) ? (
        <p className="learn-big">
          این خرید = <b>{x.toLocaleString('fa-IR', { maximumFractionDigits: 0 })} ساعت</b> کار شما ({(x / 8).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} روز کاری).
        </p>
      ) : null}
    </>
  );
}

function Inflation() {
  const b = useBook();
  const [amt, setAmt] = useState('10000000');
  const [rate, setRate] = useState(String(b.inflation));
  const [yrs, setYrs] = useState('3');
  const a = parseAmount(amt);
  const r = parseAmount(rate);
  const y = parseAmount(yrs);
  const ok = isNum(a) && a > 0 && isNum(r) && r >= 0 && isNum(y) && y >= 0 && y <= 50;
  const f = ok ? inflate(a, r, y) : null;
  return (
    <>
      <div className="fin-grid">
        <TomanInput label="مبلغ امروز (تومان)" value={amt} onChange={setAmt} />
        <NumInput label="تورم سالانه (٪)" value={rate} onChange={setRate} />
        <NumInput label="چند سال بعد" value={yrs} onChange={setYrs} />
      </div>
      {f ? (
        <dl className="fin-kpis tight">
          <Out label="همان چیز آن موقع">
            <Money rial={T(f.future)} short />
          </Out>
          <Out label="این پول، اگر بی‌سود بماند، آن موقع می‌خرد" sub="به قیمت‌های امروز">
            <Money rial={T(f.buys)} short />
          </Out>
          <Out label="دو برابر شدن قیمت‌ها">{yearsFa(doublingYears(r))}</Out>
        </dl>
      ) : null}
    </>
  );
}

function RealReturn() {
  const b = useBook();
  const [nom, setNom] = useState(String(b.safeYield));
  const [inf, setInf] = useState(String(b.inflation));
  const n = parseAmount(nom);
  const i = parseAmount(inf);
  const r = isNum(n) && isNum(i) ? realReturnPct(n, i) : null;
  return (
    <>
      <div className="fin-grid">
        <NumInput label="سود اسمی سالانه (٪)" value={nom} onChange={setNom} />
        <NumInput label="تورم سالانه (٪)" value={inf} onChange={setInf} />
      </div>
      {isNum(r) ? (
        <p className="learn-big">
          سود واقعی: <b className={r >= 0 ? 'up' : 'down'}>{fmtPctFa(r, 1)}</b> {r >= 0 ? '— قدرت خرید بیشتر شد.' : '— پول بیشتر شد، قدرت خرید کمتر.'}
        </p>
      ) : null}
    </>
  );
}

function Compound() {
  const b = useBook();
  const [init, setInit] = useState('10000000');
  const [mon, setMon] = useState('3000000');
  const [rate, setRate] = useState(String(b.safeYield));
  const [yrs, setYrs] = useState('5');
  const r = parseAmount(rate);
  const y = parseAmount(yrs);
  const i0 = parseAmount(init) || 0;
  const m = parseAmount(mon) || 0;
  const ok = isNum(r) && r > -100 && isNum(y) && y > 0 && y <= 50;
  const c = ok ? compound(i0, m, r, y, b.inflation) : null;
  return (
    <>
      <div className="fin-grid">
        <TomanInput label="مبلغ اولیه (تومان)" value={init} onChange={setInit} />
        <TomanInput label="پس‌انداز ماهانه (تومان)" value={mon} onChange={setMon} />
        <NumInput label="سود سالانه (٪)" value={rate} onChange={setRate} />
        <NumInput label="چند سال" value={yrs} onChange={setYrs} />
      </div>
      {c ? (
        <dl className="fin-kpis tight">
          <Out label="جمع واریزی شما">
            <Money rial={T(c.deposited)} short />
          </Out>
          <Out label="ارزش در پایان">
            <Money rial={T(c.nominal)} short />
          </Out>
          <Out label="به پول امروز" sub={`با تورم ${fmtPctFa(b.inflation)} (تنظیمات دفتر)`}>
            <Money rial={T(c.real)} short />
          </Out>
        </dl>
      ) : null}
    </>
  );
}

function Diversify() {
  const [rho, setRho] = useState(0.7);
  const vol = 30;
  const mix = mixVol(vol, rho);
  return (
    <div className="learn-div">
      <label className="learn-range">
        <span>
          همبستگی دو دارایی: <b className="num">{rho.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}</b>
        </span>
        <input type="range" min={-1} max={1} step={0.05} value={rho} onChange={(e) => setRho(Number(e.target.value))} aria-label="همبستگی" />
      </label>
      <div className="learn-bars" aria-hidden="true">
        <div>
          <i style={{ width: `${(vol / 30) * 100}%` }} />
          <span>هرکدام به‌تنهایی: {fmtPctFa(vol)}</span>
        </div>
        <div>
          <i className="mix" style={{ width: `${(mix / 30) * 100}%` }} />
          <span>نیمی از هرکدام: {fmtPctFa(mix, 1)}</span>
        </div>
      </div>
      <p className="muted small">
        نوسان سالانه هر دارایی ۳۰٪ فرض شده. با همبستگی ۱ تنوع هیچ اثری ندارد؛ با ۰ نوسان حدود ۲۹٪ کم می‌شود؛ با همبستگی واقعی دارایی‌های ریالی (۰٫۶۳ تا ۰٫۷۸) فقط ۶ تا ۱۰٪.{' '}
        <button type="button" className="linkish" onClick={() => setRho(0.7)}>
          همبستگی ایران
        </button>{' '}
        ·{' '}
        <button type="button" className="linkish" onClick={() => setRho(0)}>
          بی‌ارتباط
        </button>
      </p>
    </div>
  );
}

function Position() {
  const [cap, setCap] = useState('100000000');
  const [risk, setRisk] = useState('1');
  const [entry, setEntry] = useState('100000');
  const [stop, setStop] = useState('95000');
  const p = positionSize(parseAmount(cap), parseAmount(risk), parseAmount(entry), parseAmount(stop));
  return (
    <>
      <div className="fin-grid">
        <TomanInput label="کل سرمایه (تومان)" value={cap} onChange={setCap} />
        <NumInput label="ریسک هر معامله (٪)" value={risk} onChange={setRisk} />
        <TomanInput label="قیمت ورود (تومان)" value={entry} onChange={setEntry} />
        <TomanInput label="حد ضرر (تومان)" value={stop} onChange={setStop} />
      </div>
      {p ? (
        <dl className="fin-kpis tight">
          <Out label="اندازه موقعیت" sub={`${p.units.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} واحد`}>
            <Money rial={T(p.size)} short />
          </Out>
          <Out label="ضرر اگر حد ضرر بخورد" sub={`فاصله تا حد ضرر: ${fmtPctFa(p.stopPct, 1)}`}>
            <Money rial={T(p.riskAmount)} short />
          </Out>
        </dl>
      ) : (
        <p className="fin-err">حد ضرر باید زیر قیمت ورود باشد و همه عددها مثبت.</p>
      )}
    </>
  );
}

const W: Record<WidgetKey, () => React.ReactNode> = {
  budget: Budget,
  emergency: Emergency,
  workHours: Hours,
  inflation: Inflation,
  realReturn: RealReturn,
  compound: Compound,
  diversify: Diversify,
  position: Position,
};

export default function LessonWidget({ k }: { k: WidgetKey }) {
  const C = W[k];
  return (
    <div className="learn-widget" data-widget={k}>
      <C />
    </div>
  );
}
