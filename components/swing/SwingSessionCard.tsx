'use client';
// One live swing session (shared server session or «جلسه من» on the device): value, open positions, closed
// trades and the latest events. Actions (stop, refresh) come from the caller.
import { fmtDateTimeFa as fdt, fmtInt, fmtNum } from '@/lib/num';
import { SWING_EXIT_LABEL } from '@/lib/engine/swing';
import type { SwingLiveSession } from '@/lib/engine/swing-live';
import { Pct } from '../ui';
import { tomanWords } from '../TradeEntry';

export default function SwingSessionCard({ s, title, children, testId }: { s: SwingLiveSession; title: string; children?: React.ReactNode; testId?: string }) {
  const last = s.equity[s.equity.length - 1]?.equity ?? s.config.capitalToman;
  return (
    <section className="panel pad live-swing" data-testid={testId}>
      <div className="live-status-top">
        <span className={`state-pill ${s.status === 'running' ? 'ok' : 'warn'}`}>{s.status === 'running' ? title : `${title} — پایان‌یافته`}</span>
        <span className="muted">{s.config.coins.map((c) => c.symbol).join('، ')}، کندل {fmtInt(s.barMinutes)} دقیقه‌ای</span>
      </div>
      <dl className="metrics">
        <div>
          <dt>ارزش کنونی</dt>
          <dd className="num">{tomanWords(last)}</dd>
        </div>
        <div>
          <dt>بازده</dt>
          <dd><Pct v={(last / s.config.capitalToman - 1) * 100} digits={2} /></dd>
        </div>
        <div>
          <dt>معاملات بسته‌شده</dt>
          <dd className="num">{fmtInt(s.fills.length)}</dd>
        </div>
        <div>
          <dt>موقعیت باز</dt>
          <dd className="num">{fmtInt(s.open.length)}</dd>
        </div>
        <div>
          <dt>{s.status === 'running' ? 'پایان' : 'پایان یافت'}</dt>
          <dd>{fdt(s.finishedAt ?? s.endsAt)}</dd>
        </div>
        <div>
          <dt>آخرین بررسی</dt>
          <dd>{fdt(s.lastTickAt)}</dd>
        </div>
      </dl>

      {s.open.length ? (
        <div className="table-scroll">
          <table className="t compact">
            <thead>
              <tr>
                <th scope="col">ارز</th>
                <th scope="col">ورود</th>
                <th scope="col">قیمت لحظه‌ای</th>
                <th scope="col">سود/زیان باز</th>
                <th scope="col">هدف / حد ضرر</th>
              </tr>
            </thead>
            <tbody>
              {s.open.map((o) => (
                <tr key={o.coinId}>
                  <th scope="row">{o.symbol}</th>
                  <td className="num">{fmtNum(o.entryPrice, 4)}</td>
                  <td className="num">{fmtNum(o.markPrice, 4)}</td>
                  <td><Pct v={o.unrealisedPct} digits={2} /></td>
                  <td className="num muted">{Number.isFinite(o.targetPrice) ? fmtNum(o.targetPrice, 4) : '—'} / {fmtNum(o.stopPrice, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {s.fills.length ? (
        <div className="table-scroll">
          <table className="t compact">
            <thead>
              <tr>
                <th scope="col">ارز</th>
                <th scope="col">خروج</th>
                <th scope="col">بازده</th>
                <th scope="col">سود/زیان</th>
              </tr>
            </thead>
            <tbody>
              {[...s.fills].reverse().slice(0, 12).map((f, i) => (
                <tr key={`${f.coinId}-${f.exitAt}-${i}`}>
                  <th scope="row">{f.symbol}</th>
                  <td>{SWING_EXIT_LABEL[f.exit]}</td>
                  <td><Pct v={f.netPct} digits={2} /></td>
                  <td className="num">{tomanWords(f.pnlToman)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">هنوز معامله‌ای بسته نشده است.</p>
      )}

      <ul className="event-list">
        {s.events.slice(0, 5).map((e, i) => (
          <li className="event-row" key={i}>
            <span className="event-when">{fdt(e.at)}</span>
            <span className="event-text">{e.text}</span>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}
