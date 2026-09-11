import { fmtInt, fmtPct, isNum } from '@/lib/num';
import type { Snapshot } from '@/lib/types';

const sign = (p: number | null) => (!isNum(p) || p === 0 ? 'flat' : p > 0 ? 'up' : 'down');

export default function StockScreener({ stocks }: { stocks: Snapshot['stocks'] }) {
  return (
    <section className="block" id="stocks">
      <div className="wrap">
        <h2>بورس و فرابورس: ۱۰ سهم مستعد رشد در یک ماه</h2>
        <p className="lede">
          قدرت نسبی به شاخص، جهش ارزش معاملات، نزدیکی به سقف ۶۰ روزه، روند میانگین‌ها و ورود پول حقیقی؛ نمادهای زیان‌ده، اشباع خرید و صف خرید جریمه می‌شوند.
        </p>
        {stocks.mode !== 'history' ? <p className="banner">{stocks.note}</p> : null}
        <div className="surface">
          {stocks.rows.length === 0 ? (
            <p className="empty">{stocks.note}</p>
          ) : (
            <div className="table-scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>نماد</th>
                    <th>قیمت (ریال)</th>
                    <th>امروز</th>
                    <th>۲۰ روز</th>
                    <th>۶۰ روز</th>
                    <th>جهش حجم</th>
                    <th>P/E</th>
                    <th>امتیاز</th>
                    <th>ریسک ماه</th>
                    <th>دلایل و هشدارها</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.rows.map((r) => (
                    <tr key={r.symbol}>
                      <td className="rank num">{fmtInt(r.rank)}</td>
                      <td className="sym">
                        {r.symbol}
                        <small>{r.name}</small>
                      </td>
                      <td className="num">{fmtInt(r.price)}</td>
                      <td className={`num ltr ${sign(r.chgToday)}`}>{fmtPct(r.chgToday)}</td>
                      <td className={`num ltr ${sign(r.r20)}`}>{fmtPct(r.r20, 0)}</td>
                      <td className={`num ltr ${sign(r.r60)}`}>{fmtPct(r.r60, 0)}</td>
                      <td className="num">{isNum(r.volSurge) ? `×${r.volSurge.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}` : '—'}</td>
                      <td className="num">{isNum(r.pe) ? r.pe.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '—'}</td>
                      <td>
                        <span className="scorebar num">
                          <span className="bar">
                            <b style={{ width: `${r.score}%` }} />
                          </span>
                          {fmtInt(r.score)}
                        </span>
                      </td>
                      <td className="num">{fmtInt(r.riskMonth)}</td>
                      <td className="reasons">
                        {r.flags.map((f) => (
                          <span className="flag" key={f}>
                            {f}
                          </span>
                        ))}
                        {r.reasons.join('؛ ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
