'use client';
import { fmtInt, fmtNum, fmtPct, fmtPrice, isNum } from '@/lib/num';
import { SIM_ASSETS, type SimAsset, type SimTrade, type TradeKind } from '@/lib/engine/simulator';

const faShort = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
const faYear = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
const faTime = (ms: number) => new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

export function tomanWords(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} میلیارد تومان`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون تومان`;
  return `${sign}${fmtInt(a)} تومان`;
}

export const KIND: Record<TradeKind, string> = { entry: 'ورود', add: 'افزایش', trim: 'کاهش', exit: 'خروج', stop: 'حد ضرر', take_profit: 'سیو سود' };
const META = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<SimAsset, (typeof SIM_ASSETS)[number]>;

export interface TradeFlagView {
  code: string;
  text: string;
}

function unitPrice(t: SimTrade) {
  if (t.asset === 'tse') return `شاخص ${fmtInt(t.price)}`;
  return `${fmtPrice(t.price / 10)} تومان برای هر ${META[t.asset].unit}`;
}
function qtyText(t: SimTrade) {
  if (t.asset === 'tse') return null;
  const digits = t.asset === 'btc' || t.asset === 'eth' ? 4 : t.asset === 'g18' ? 1 : t.asset === 'usd' ? 0 : 1;
  return `${fmtNum(t.qty, digits)} ${META[t.asset].unit}`;
}

export default function TradeEntry({ t, flags = [], at }: { t: SimTrade; flags?: TradeFlagView[]; at?: number }) {
  const qty = qtyText(t);
  return (
    <li className={`entry ${t.side}`} id={`trade-${t.n}`}>
      <div className="entry-when">
        <span className="entry-n num">{fmtInt(t.n)}</span>
        <span className="entry-day">{faShort(t.date)}</span>
        <small>{at ? faTime(at) : faYear(t.date)}</small>
      </div>
      <div className="entry-body">
        <p className="entry-line">
          <span className={`act ${t.side}`}>{t.side === 'buy' ? 'خرید' : 'فروش'}</span>
          <strong>{META[t.asset].label}</strong>
          <span className="tag">{KIND[t.kind]}</span>
          <span className="entry-amt num">{tomanWords(t.valueToman)}</span>
        </p>
        {flags.length ? (
          <ul className="flags" aria-label="خطاهای تشخیص‌داده‌شده">
            {flags.map((f) => (
              <li key={f.code} className={`flag ${f.code}`}>
                {f.text}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="entry-sub">
          {qty ? <>{qty}، </> : null}
          {unitPrice(t)}، کارمزد {tomanWords(t.feeToman)}، وزن پس از معامله {fmtPct(t.weightAfter * 100, 0, false)}
          {isNum(t.realizedToman) ? (
            <>
              ، نتیجه <b className={t.realizedToman >= 0 ? 'up' : 'down'}>{tomanWords(t.realizedToman)} ({fmtPct(t.realizedPct, 1)})</b>
              {isNum(t.holdDays) ? ` پس از ${fmtInt(t.holdDays)} روز` : ''}
            </>
          ) : null}
        </p>
        <details className="why" open={t.kind === 'stop' || t.news.length > 0}>
          <summary>
            دلیل تصمیم <span className="muted small">(تصمیم {faShort(t.decisionDate)}، امتیاز {fmtInt(t.score)}{t.newsScore ? `، سهم اخبار ${fmtInt(t.newsScore)}` : ''})</span>
          </summary>
          <ul>
            {t.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {t.news.length ? (
            <ul className="cites" aria-label="خبرهای مؤثر در این تصمیم">
              {t.news.map((n) => (
                <li key={n.id}>
                  <span className={`fx ${n.effect >= 0 ? 'up' : 'down'}`} aria-hidden="true">{n.effect >= 0 ? '▲' : '▼'}</span>
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noreferrer">
                      {n.title}
                    </a>
                  ) : (
                    n.title
                  )}
                  <small>
                    {n.source}، {faShort(n.date)}: {n.facts.join('، ')}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </div>
    </li>
  );
}

