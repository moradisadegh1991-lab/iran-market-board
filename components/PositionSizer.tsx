'use client';
import { useMemo, useState } from 'react';
import { lossesToDrawdown, sizePosition } from '@/lib/engine/sizing';
import { fmtInt, fmtNum, fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { AssetRisk } from '@/lib/types';
import { tomanWords } from './TradeEntry';
import { Chips } from './ui';

const RISK_STEPS = ['0.5', '1', '2', '3'];
const HOLD_STEPS = ['1', '5', '30', '90'];
const digitsOnly = (v: string) => v.replace(/[^\d]/g, '');
const decimal = (v: string) => v.replace(/[^\d.]/g, '');

/** Assets whose live price is a sane default entry, with the fee they actually cost to trade. */
const FEE_HINT: Record<string, number> = {
  usd: 0.6, usdt: 0.4, g18: 0.8, coin: 0.6,
  // small coins and silver trade on wider spreads than the full coin — the smaller and less
  // liquid the piece, the more of the move the dealer keeps
  nim: 0.9, rob: 1.2, silver: 1.5,
  btc: 0.4, eth: 0.4, tse: 0.5,
};

export default function PositionSizer({ assets }: { assets: AssetRisk[] }) {
  const usable = assets.filter((a) => !a.hidden && isNum(a.price) && a.price! > 0);
  const [assetKey, setAssetKey] = useState<string>(usable[0]?.key ?? '');
  const asset = usable.find((a) => a.key === assetKey) ?? usable[0];

  const [capital, setCapital] = useState('100000000');
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [fee, setFee] = useState('');
  const [holdDays, setHoldDays] = useState('5');
  const [openRisk, setOpenRisk] = useState('0');

  // live price as the default entry, and the asset's own trading cost as the default fee
  const entryPrice = Number(entry) > 0 ? Number(entry) : asset?.price ?? 0;
  const feePct = fee !== '' ? Number(fee) : (asset ? FEE_HINT[asset.key] ?? 0.5 : 0.5);

  const result = useMemo(() => {
    if (!asset || !(entryPrice > 0) || !(Number(stop) > 0)) return null;
    return sizePosition({
      capitalToman: Number(capital),
      riskPctPerTrade: Number(riskPct),
      entryPrice,
      stopPrice: Number(stop),
      targetPrice: Number(target) > 0 ? Number(target) : null,
      feePctPerSide: feePct,
      annualVolPct: asset.annualVolPct,
      holdDays: Number(holdDays) > 0 ? Number(holdDays) : null,
      openRiskPct: Number(openRisk),
    });
  }, [asset, capital, riskPct, entryPrice, stop, target, feePct, holdDays, openRisk]);

  // a stop suggested from the asset's own volatility, so the field starts somewhere sensible
  const suggestedStop = useMemo(() => {
    if (!asset || !isNum(asset.annualVolPct) || !(entryPrice > 0)) return null;
    const move = (asset.annualVolPct / 100) * Math.sqrt(Math.max(1, Number(holdDays) || 5) / 365);
    return entryPrice * (1 - 1.5 * move);
  }, [asset, entryPrice, holdDays]);

  const unit = asset?.unit === 'usd' ? 'دلار' : asset?.unit === 'point' ? 'واحد' : 'تومان';
  const streak = lossesToDrawdown(Number(riskPct) || 1, 20);

  if (!asset) return null;

  return (
    <section className="panel pad sizer" aria-labelledby="sizer-h">
      <h2 id="sizer-h">چقدر بخرم؟ محاسبه حجم بر پایه حد ضرر</h2>
      <p className="lede">
        اول تصمیم بگیرید حاضرید چقدر از سرمایه را در این معامله از دست بدهید، بعد فاصله تا حد ضرر حجم را تعیین کند.
        حد ضرر نزدیک‌تر یعنی حجم بزرگ‌تر، ولی پولی که در معرض خطر است ثابت می‌ماند — کل فایده این قاعده همین است.
      </p>

      <div className="sizer-grid">
        <div>
          <span className="field-label">دارایی</span>
          <Chips
            label="دارایی"
            value={assetKey}
            onChange={(k) => {
              setAssetKey(k);
              setEntry('');
              setStop('');
              setTarget('');
              setFee('');
            }}
            options={usable.map((a) => ({ key: a.key, label: a.label }))}
          />
          <small className="muted">
            قیمت فعلی <bdi>{fmtPrice(asset.price)}</bdi> {unit}
            {isNum(asset.annualVolPct) ? ` · نوسان سالانه ${fmtPct(asset.annualVolPct, 0, false)}` : ''}
          </small>
        </div>

        <label className="field cap-field">
          <span className="field-label">سرمایه کل (تومان)</span>
          <input inputMode="numeric" value={capital} onChange={(e) => setCapital(digitsOnly(e.target.value))} />
          <small className="muted">{Number(capital) > 0 ? tomanWords(Number(capital)) : ''}</small>
        </label>

        <div>
          <span className="field-label">ریسک این معامله (٪ سرمایه)</span>
          <Chips label="ریسک هر معامله" value={riskPct} onChange={setRiskPct} options={RISK_STEPS.map((r) => ({ key: r, label: `${Number(r).toLocaleString('fa-IR')}٪` }))} />
          <small className="muted">
            با {Number(riskPct).toLocaleString('fa-IR')}٪ ریسک، {fmtInt(streak)} باخت پشت سر هم سرمایه را ۲۰٪ کم می‌کند.
          </small>
        </div>

        <label className="field cap-field">
          <span className="field-label">قیمت ورود ({unit})</span>
          <input inputMode="decimal" value={entry} placeholder={String(Math.round(asset.price ?? 0))} onChange={(e) => setEntry(decimal(e.target.value))} />
          <small className="muted">خالی بگذارید تا قیمت زنده استفاده شود</small>
        </label>

        <label className="field cap-field">
          <span className="field-label">حد ضرر ({unit})</span>
          <input inputMode="decimal" value={stop} onChange={(e) => setStop(decimal(e.target.value))} />
          <small className="muted">
            {suggestedStop ? (
              <button type="button" className="linkish" onClick={() => setStop(String(Math.round(suggestedStop)))}>
                پیشنهاد بر پایه نوسان: <bdi>{fmtPrice(suggestedStop)}</bdi>
              </button>
            ) : (
              'پایین‌تر از قیمت ورود'
            )}
          </small>
        </label>

        <label className="field cap-field">
          <span className="field-label">هدف سود ({unit}) — اختیاری</span>
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(decimal(e.target.value))} />
          <small className="muted">برای محاسبه نسبت سود به زیان</small>
        </label>

        <label className="field cap-field">
          <span className="field-label">کارمزد و اسپرد هر طرف (٪)</span>
          <input inputMode="decimal" value={fee} placeholder={String(feePct)} onChange={(e) => setFee(decimal(e.target.value))} />
          <small className="muted">هر دو طرف معامله حساب می‌شود</small>
        </label>

        <div>
          <span className="field-label">مدت نگه‌داری (روز)</span>
          <Chips label="مدت نگه‌داری" value={holdDays} onChange={setHoldDays} options={HOLD_STEPS.map((d) => ({ key: d, label: `${Number(d).toLocaleString('fa-IR')} روز` }))} />
          <small className="muted">برای سنجش اینکه حد ضرر داخل نوسان عادی نیفتد</small>
        </div>

        <label className="field cap-field">
          <span className="field-label">ریسک موقعیت‌های باز دیگر (٪)</span>
          <input inputMode="decimal" value={openRisk} onChange={(e) => setOpenRisk(decimal(e.target.value))} />
          <small className="muted">مجموع ریسک معامله‌های بازی که همین حالا دارید</small>
        </label>
      </div>

      {!result ? (
        <p className="banner info">برای دیدن حجم مجاز، حد ضرر را وارد کنید.</p>
      ) : !result.ok ? (
        <p className="banner warn">{result.reason}</p>
      ) : (
        <>
          <dl className="sizer-out">
            <div className="wide">
              <dt>حجم مجاز خرید</dt>
              <dd className="num big">
                {tomanWords(result.positionToman)} <small>({fmtPct(result.positionPct, 1, false)} سرمایه)</small>
              </dd>
            </div>
            <div>
              <dt>مقدار</dt>
              <dd className="num">
                <bdi>{fmtNum(result.qty, result.qty < 10 ? 4 : result.qty < 1000 ? 2 : 0)}</bdi>
              </dd>
            </div>
            <div>
              <dt>اگر حد ضرر بخورد</dt>
              <dd className="num down">
                −{tomanWords(result.riskToman)} <small>({fmtPct(result.riskPct, 2, false)})</small>
              </dd>
            </div>
            <div>
              <dt>فاصله تا حد ضرر</dt>
              <dd className="num">{fmtPct(result.stopDistancePct, 1, false)}</dd>
            </div>
            <div>
              <dt>زیان واقعی هر واحد</dt>
              <dd className="num">
                <bdi>{fmtPrice(result.lossPerUnit)}</bdi> <small>با کارمزد دو طرف</small>
              </dd>
            </div>
            {isNum(result.rMultiple) ? (
              <div>
                <dt>نسبت سود به زیان</dt>
                <dd className="num">{fmtNum(result.rMultiple, 2)}</dd>
              </div>
            ) : null}
            {isNum(result.breakEvenWinRatePct) ? (
              <div>
                <dt>نرخ برد لازم برای سر‌به‌سر</dt>
                <dd className="num">{fmtPct(result.breakEvenWinRatePct, 0, false)}</dd>
              </div>
            ) : null}
          </dl>

          {result.stopVsNoise ? (
            <p className={`banner ${result.stopVsNoise.ratio < 0.7 ? 'warn' : 'info'}`}>{result.stopVsNoise.verdict}</p>
          ) : null}
          {result.warnings
            .filter((w) => !result.stopVsNoise || !w.includes('نوسان طبیعی'))
            .map((w) => (
              <p className="banner warn" key={w}>
                {w}
              </p>
            ))}
          <p className="muted small sizer-foot">
            این محاسبه فقط اندازه موقعیت را می‌گوید، نه اینکه معامله خوب است یا نه. قیمت اجرا در بازار واقعی — به‌خصوص
            در صف و در ساعت‌های کم‌عمق — می‌تواند با حد ضرر فاصله داشته باشد، پس زیان واقعی گاهی از این عدد بیشتر می‌شود.
          </p>
        </>
      )}
    </section>
  );
}
