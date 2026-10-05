'use client';
import { CHANNEL_LABEL, type Business } from '@/lib/biz/model';
import { analyze, priceChecks } from '@/lib/biz/reports';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtPctFa, Money } from '../finance/kit';
import { fa, WEEK_ORDER, WEEKDAYS_FA, WithBiz } from './kit';

function Reports({ b }: { b: Business }) {
  const { today } = useFinance();
  const a = analyze(b, today);
  const pc = priceChecks(b);
  if (!a.orders)
    return (
      <>
        <p className="banner info">هنوز فروشی در ۹۰ روز اخیر نیست. بعد از چند فروش، ساعت و روز پرفروش، محصولات ستاره و کم‌فروش این‌جا می‌آیند.</p>
        {pc.length ? <Prices b={b} /> : null}
      </>
    );
  const maxH = Math.max(1, ...a.byHour);
  const maxD = Math.max(1, ...a.byWeekday);
  const trendUp = a.weeks[3] >= a.weeks[2];
  return (
    <>
      <p className="muted small">۹۰ روز اخیر، {fa(a.orders)} فروش، جمع <Money rial={a.revenueRial} short />.</p>
      <dl className="fin-kpis">
        <div className="fin-stat">
          <dt>پرفروش‌ترین ساعت</dt>
          <dd data-testid="peak-hour">
            {fa(a.peakHour)} تا {fa((a.peakHour + 1) % 24)}
          </dd>
        </div>
        <div className="fin-stat">
          <dt>پرفروش‌ترین روز</dt>
          <dd>{WEEKDAYS_FA[a.peakWeekday]}</dd>
        </div>
        <div className="fin-stat">
          <dt>میانگین هر فروش</dt>
          <dd>
            <Money rial={a.avgOrderRial} short />
          </dd>
        </div>
        <div className="fin-stat">
          <dt>این هفته در برابر هفته قبل</dt>
          <dd className={trendUp ? 'up' : 'down'}>{a.weeks[2] ? fmtPctFa(((a.weeks[3] - a.weeks[2]) / a.weeks[2]) * 100) : trendUp ? 'بالاتر' : '—'}</dd>
        </div>
      </dl>
      <Card title="فروش بر اساس ساعت">
        <div className="biz-bars hours" role="img" aria-label="فروش بر اساس ساعت روز">
          {a.byHour.map((v, h) => (
            <div key={h} className="biz-bar">
              <b style={{ height: `${(v / maxH) * 100}%` }} />
              <small>{h % 3 === 0 ? fa(h) : ''}</small>
            </div>
          ))}
        </div>
      </Card>
      <Card title="فروش بر اساس روز هفته">
        <ul className="biz-hbars">
          {WEEK_ORDER.map((w) => (
            <li key={w}>
              <span>{WEEKDAYS_FA[w]}</span>
              <span className="fin-bar ok">
                <b style={{ width: `${(a.byWeekday[w] / maxD) * 100}%` }} />
              </span>
              <Money rial={a.byWeekday[w]} short />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="پرفروش‌ترین‌ها">
        <ul className="fin-list">
          {a.top.map((p) => (
            <li key={p.id} className="fin-list-row">
              <span className="fin-list-main">
                <b>{p.name}</b>
                <small>{fa(p.qty)} عدد</small>
              </span>
              <span className="fin-list-nums">
                <Money rial={p.revenueRial} short />
                <small className={p.marginRial >= 0 ? 'up' : 'down'}>
                  سود <Money rial={p.marginRial} short />
                </small>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {a.unsold.length ? (
        <Card title="بدون فروش در ۹۰ روز">
          <p className="small">{a.unsold.map((p) => p.name).join('، ')} — قیمت، جایشان در منو، یا حذفشان را بازبینی کنید.</p>
        </Card>
      ) : null}
      {a.byChannel.length > 1 ? (
        <Card title="فروش بر اساس کانال">
          <ul className="fin-list">
            {a.byChannel.map((c) => (
              <li key={c.channel} className="fin-list-row">
                <span>{CHANNEL_LABEL[c.channel]}</span>
                <Money rial={c.revenueRial} short />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Prices b={b} />
      <Card title="چه کاری بکنم؟">
        <ul className="biz-tips">
          <li>
            حدود ساعت {fa(a.peakHour)} بیشترین فروش را دارید؛ آن ساعت نیرو و موجودی آماده باشد و تخفیف لازم نیست.
          </li>
          <li>
            {WEEKDAYS_FA[a.slowWeekday]} کم‌فروش‌ترین روز است؛ تخفیف همان روز یا پیامک به مشتری‌های غیرفعال را امتحان کنید و نتیجه را این‌جا ببینید.
          </li>
          {a.top[0] ? <li>«{a.top[0].name}» پرفروش‌ترین است؛ در منو و صفحه آنلاین بالاتر بگذاریدش.</li> : null}
          <li>
            میانگین هر فروش <Money rial={a.avgOrderRial} short /> است؛ پیشنهاد یک قلم کنار سفارش (نوشیدنی، دسر) این عدد را بالا می‌برد.
          </li>
        </ul>
        <p className="muted small">این‌ها خلاصه فروش گذشته خودتان است، نه پیش‌بینی؛ هر تغییر را چند هفته بسنجید.</p>
      </Card>
    </>
  );
}

function Prices({ b }: { b: Business }) {
  const pc = priceChecks(b);
  if (!pc.length) return null;
  return (
    <Card title="قیمت‌هایی که سود نمی‌دهند">
      <p className="small">بهای تمام‌شده از فرمول ساخت با آخرین میانگین قیمت خرید و دستمزد. «پیشنهاد» قیمتی است که ۳۰٪ حاشیه بگذارد — بازار و رقیب را هم در نظر بگیرید.</p>
      <ul className="fin-list">
        {pc.map((x) => (
          <li key={x.product.id} className="fin-list-row" data-testid="price-check">
            <span className="fin-list-main">
              <b>{x.product.name}</b>
              <small>
                قیمت <Money rial={x.product.priceRial} />، تمام‌شده <Money rial={x.costRial} />
                {x.marginPct !== null ? `، حاشیه ${fmtPctFa(x.marginPct)}` : ''}
              </small>
            </span>
            <span className="fin-list-nums">
              <small>پیشنهاد</small>
              <Money rial={x.suggestedRial} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ReportsView() {
  return <WithBiz title="تحلیل فروش" lede="ساعت و روز پرفروش، محصولات ستاره و کم‌فروش، کانال‌ها و قیمت‌هایی که زیر بهای تمام‌شده‌اند.">{(_d, b) => <Reports b={b} />}</WithBiz>;
}
