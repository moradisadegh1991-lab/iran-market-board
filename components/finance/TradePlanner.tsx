'use client';
import { useState } from 'react';
import { tradePlan } from '@/lib/engine/trade-plan';
import { parseAmount } from './kit';
const read = (s: string) => /^[\d۰-۹٠-٩٬,٫.\s]+$/.test(s) ? parseAmount(s) : NaN;

const fa = (n: number, digits = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: digits });
const fields = [
  ['capital', 'سرمایه اختصاص‌یافته (تومان)', '100000000'], ['entry', 'قیمت ورود هر واحد (تومان)', '1000000'],
  ['stop', 'حد ضرر هر واحد (تومان)', '950000'], ['target', 'هدف فروش هر واحد (تومان)', '1100000'],
  ['fee', 'کارمزد هر طرف (٪)', '0.4'], ['slippage', 'لغزش هر طرف (٪)', '0.5'],
  ['riskPct', 'حداکثر ریسک معامله (٪ سرمایه)', '1'], ['maxPositionPct', 'سقف ارزش موقعیت (٪ سرمایه)', '25'],
] as const;
type Key = typeof fields[number][0];
const initial = Object.fromEntries(fields.map(([key, , value]) => [key, value])) as Record<Key, string>;
export default function TradePlanner() {
  const [v, setV] = useState(initial);
  const x = Object.fromEntries(fields.map(([key]) => [key, read(v[key])])) as Record<Key, number>;
  const p = tradePlan(x);
  return <section className="panel pad trade-plan" aria-labelledby="trade-plan-title">
    <h2 id="trade-plan-title">برنامهٔ معامله پیش از ورود</h2>
    <p className="muted">یک سناریوی خرید نقدی را با کارمزد و لغزش هر دو طرف بررسی کنید. قیمت‌ها باید همگی به تومان و برای یک واحد باشند.</p>
    <div className="trade-plan-grid">{fields.map(([key, label]) => <label key={key} className="field"><span className="field-label">{label}</span><input inputMode="decimal" dir="ltr" value={v[key]} onChange={e => setV({ ...v, [key]: e.target.value })} /></label>)}</div>
    {!p ? <p className="banner warn" role="status">اعداد معتبر وارد کنید: سرمایه و قیمت‌ها مثبت، حد ضرر کمتر و هدف بیشتر از ورود باشد؛ ریسک تا ۱۰٪، کارمزد تا ۱۰٪ و لغزش تا ۲۰٪ هر طرف.</p> : <>
      <dl className="trade-plan-results" aria-live="polite">
        <div><dt>حداکثر ارزش خرید با هزینه</dt><dd>{fa(p.investment)} تومان</dd></div>
        <div><dt>تعداد تقریبی</dt><dd>{fa(p.qty, 5)} واحد</dd></div>
        <div><dt>زیان سناریوی حد ضرر</dt><dd>{fa(p.loss)} تومان</dd></div>
        <div><dt>نتیجه سناریوی هدف</dt><dd>{fa(p.profit)} تومان</dd></div>
        <div><dt>قیمت سر‌به‌سر</dt><dd>{fa(p.breakEvenPrice)} تومان</dd></div>
        <div><dt>نسبت سود به زیان پس از هزینه</dt><dd>{fa(p.rewardRisk, 2)}</dd></div>
        <div><dt>نرخ برد سر‌به‌سر</dt><dd>{p.breakEvenWinRate === null ? 'هدف سودده نیست' : `${fa(p.breakEvenWinRate, 1)}٪`}</dd></div>
      </dl>
      {!p.targetViable ? <p className="banner warn">هدف انتخابی پس از هزینه‌ها سود ایجاد نمی‌کند.</p> : null}
      <p className="note">مقدار تقریبی است و حداقل سفارش، گرد کردن تعداد، مالیات، نقدشوندگی و شکاف قیمتی لحاظ نشده‌اند. حد ضرر تضمین اجرای قیمت نیست و زیان واقعی ممکن است بیشتر شود. نرخ برد لازم پیش‌بینی نرخ برد شما نیست.</p>
    </>}
  </section>;
}
