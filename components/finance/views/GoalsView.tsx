'use client';
import { useState } from 'react';
import { dkProduct } from '@/lib/digikala/client';
import type { DkProduct } from '@/lib/digikala/parse';
import { loanVsSave, type RateKind } from '@/lib/finance/bnpl';
import { addDays, goalPlan } from '@/lib/finance/calc';
import { addGoalPrice, GOAL_REFRESH_MS, goalGrowth, lastPrice, linkGoalProduct, noteGoalTry, productTrend, unlinkGoalProduct } from '@/lib/finance/goal-price';
import { newId, tomanToRial, type FinanceData, type Goal } from '@/lib/finance/model';
import { Glyph } from '../../icons';
import { Empty, PageHead, Toggle } from '../../ui';
import { DkPicker } from '../DkPicker';
import { useFinance, WithBook } from '../FinanceProvider';
import { Bar, Card, confirmDelete, Disclosure, Field, fmtDateFa, fmtPctFa, JalaliDate, Money, parseAmount, TextInput, TomanInput } from '../kit';

const faN = (n: number, d = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });
const tehranIso = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** The goal's Digikala product (rule 105): today's price, how it moved, the next automatic read, buy link. */
function GoalProductBox({ g }: { g: Goal }) {
  const { update } = useFinance();
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!g.dk) {
    return (
      <div className="goal-dk">
        <button className="fin-mini ghost" onClick={() => setPicker(true)} data-testid="goal-dk-open">
          <Glyph.Search size={14} aria-hidden="true" /> قیمت این هدف از دیجی‌کالا
        </button>
        {picker ? (
          <DkPicker
            query={g.name}
            title={`کالای هدف «${g.name}» در دیجی‌کالا`}
            note=" قیمتی که انتخاب کنید مبلغ هدف می‌شود و هر ماه دو بار (با باز کردن اپ) دوباره خوانده می‌شود."
            pickLabel="انتخاب برای این هدف"
            onPick={(p) => update((dr) => linkGoalProduct(dr.goals.find((x) => x.id === g.id)!, p))}
            onClose={() => setPicker(false)}
          />
        ) : null}
      </div>
    );
  }
  const dk = g.dk;
  const last = lastPrice(g);
  const first = dk.history.find((h) => h.priceRial);
  const change = last && first && first !== last ? (last.priceRial / first.priceRial! - 1) * 100 : null;
  const trend = productTrend(g);
  const nextAt = (dk.history.at(-1)?.at ?? 0) + GOAL_REFRESH_MS;
  const refresh = async () => {
    setBusy(true);
    const r = await dkProduct(dk.id);
    setBusy(false);
    setErr(r.ok ? null : (r.error ?? 'قیمت خوانده نشد.'));
    update((dr) => {
      const x = dr.goals.find((y) => y.id === g.id);
      if (!x) return;
      if (r.ok) addGoalPrice(x, r.value!);
      else noteGoalTry(x);
    });
  };
  return (
    <div className="goal-dk" data-testid="goal-dk">
      <span className="dk-title">
        دیجی‌کالا: {dk.title}
        {dk.qty > 1 ? ` (${faN(dk.qty)} عدد)` : ''}
      </span>
      <span className="shop-dk-row">
        {last ? (
          <>
            <Money rial={last.priceRial} /> <small className="muted">({fmtDateFa(tehranIso(last.at))})</small>
          </>
        ) : (
          <span className="muted">ناموجود</span>
        )}
        {change !== null ? (
          <small className={change > 0 ? 'down' : 'up'} data-testid="goal-dk-change">
            از {fmtDateFa(tehranIso(first!.at))}: {change > 0 ? '+' : ''}
            {fmtPctFa(change, 1)}
          </small>
        ) : null}
      </span>
      <small className="muted">
        {faN(dk.history.length)} بار قیمت گرفته شده؛ بعدی خودکار از {fmtDateFa(tehranIso(nextAt))} با باز کردن اپ.{' '}
        {trend ? `روند قیمت همین کالا: ${fmtPctFa(trend.annualPct, 0)} در سال (از ${faN(trend.points)} قیمت در ${faN(Math.round(trend.days))} روز).` : 'برای روند قیمت خود کالا دست‌کم ۳ قیمت در ۹۰ روز لازم است؛ تا آن موقع تورم تنظیمات حساب می‌شود.'}
      </small>
      <span className="shop-dk-row">
        <button className="fin-mini ghost" onClick={() => void refresh()} disabled={busy} data-testid="goal-dk-refresh">
          <Glyph.Refresh size={14} aria-hidden="true" /> {busy ? 'در حال گرفتن…' : 'قیمت الان'}
        </button>
        <a className="fin-mini ghost" href={dk.url} target="_blank" rel="noopener noreferrer">
          خرید <Glyph.External size={14} aria-hidden="true" />
        </a>
        <label className="goal-qty">
          تعداد{' '}
          <input
            className="fin-input sm"
            inputMode="numeric"
            aria-label="تعداد کالا"
            value={dk.qty}
            onChange={(e) => {
              const q = Math.max(1, Math.min(99, Math.round(parseAmount(e.target.value)) || 1));
              update((dr) => {
                const x = dr.goals.find((y) => y.id === g.id);
                if (!x?.dk) return;
                x.dk.qty = q;
                const lp = lastPrice(x);
                if (x.followPrice && lp) x.targetRial = lp.priceRial * q;
              });
            }}
          />
        </label>
        <button className="fin-mini ghost" onClick={() => update((dr) => unlinkGoalProduct(dr.goals.find((x) => x.id === g.id)!))} aria-label="حذف پیوند دیجی‌کالا">
          <Glyph.Close size={14} aria-hidden="true" />
        </button>
      </span>
      <Toggle
        checked={!!g.followPrice}
        onChange={(v) =>
          update((dr) => {
            const x = dr.goals.find((y) => y.id === g.id)!;
            x.followPrice = v;
            const lp = lastPrice(x);
            if (v && lp && x.dk) x.targetRial = lp.priceRial * x.dk.qty;
          })
        }
      >
        مبلغ هدف = آخرین قیمت دیجی‌کالا
      </Toggle>
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

/**
 * «وام خرید کالا یا پس‌انداز؟» (rule 105): an installment loan now (DigiPay and the like — the terms are the user's), or the
 * same installment saved every month until the money reaches the price. Compared by what each leaves at the loan's end.
 */
function LoanCompare({ g, growthPct, safeYieldPct }: { g: Goal; growthPct: number; safeYieldPct: number }) {
  const [rate, setRate] = useState('24');
  const [months, setMonths] = useState('12');
  const [down, setDown] = useState('0');
  const [kind, setKind] = useState<RateKind>('flat');
  const [yieldPct, setYieldPct] = useState(String(safeYieldPct));
  const [growth, setGrowth] = useState(String(Math.round(growthPct)));
  const price = lastPrice(g) ? lastPrice(g)!.priceRial * (g.dk?.qty ?? 1) : g.targetRial;
  const num = (s: string) => parseAmount(s);
  const r = loanVsSave({ priceRial: price, savedRial: g.savedRial, downPct: num(down), months: Math.max(1, Math.round(num(months)) || 1), ratePct: num(rate), rateKind: kind, growthPct: num(growth), saveYieldPct: num(yieldPct) });
  const n = Math.max(1, Math.round(num(months)) || 1);
  return (
    <Disclosure label="وام خرید کالا یا پس‌انداز؟">
      {() => (
        <div className="goal-loan" data-testid="goal-loan">
          <p className="muted small">
            مثلاً وام خرید کالای دیجی‌پی یا اقساط فروشگاه. شرایط واقعی (کارمزد، پیش‌پرداخت، چک ضمانت) را از قرارداد خود وام‌دهنده بخوانید و این‌جا بنویسید؛ این‌جا فقط حساب
            می‌کند، پیشنهاد نمی‌دهد. مبلغ کالا: <Money rial={price} />.
          </p>
          <div className="fin-grid">
            <Field label="نرخ سود (٪ در سال)">
              <input className="fin-input" inputMode="decimal" aria-label="نرخ سود" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Field label="نوع نرخ">
              <select className="fin-input" aria-label="نوع نرخ" value={kind} onChange={(e) => setKind(e.target.value as RateKind)}>
                <option value="flat">ثابت روی کل مبلغ (رایج در فروش اقساطی)</option>
                <option value="declining">روی مانده وام (مثل وام بانکی)</option>
              </select>
            </Field>
            <Field label="مدت (ماه)">
              <input className="fin-input" inputMode="numeric" aria-label="مدت وام" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field label="پیش‌پرداخت (٪ قیمت)">
              <input className="fin-input" inputMode="decimal" aria-label="پیش‌پرداخت" value={down} onChange={(e) => setDown(e.target.value)} />
            </Field>
            <Field label="بازده پس‌انداز (٪ در سال)">
              <input className="fin-input" inputMode="decimal" aria-label="بازده پس‌انداز" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
            </Field>
            <Field label="رشد قیمت کالا (٪ در سال)">
              <input className="fin-input" inputMode="decimal" aria-label="رشد قیمت کالا" value={growth} onChange={(e) => setGrowth(e.target.value)} />
            </Field>
          </div>
          <dl className="fin-kpis tight">
            <div className="fin-stat">
              <dt>قسط ماهانه</dt>
              <dd>
                <Money rial={r.monthlyRial} short />
              </dd>
            </div>
            <div className="fin-stat">
              <dt>جمع پرداخت با وام</dt>
              <dd>
                <Money rial={r.totalPaidRial} short />
              </dd>
              <dd className="fin-stat-sub">
                سود وام: <Money rial={r.interestRial} short />
              </dd>
            </div>
            <div className="fin-stat">
              <dt>هزینه واقعی وام</dt>
              <dd data-testid="goal-loan-eff">{fmtPctFa(r.effectivePct, 1)} در سال</dd>
            </div>
            <div className="fin-stat">
              <dt>با پس‌انداز همان قسط</dt>
              <dd data-testid="goal-loan-month">
                {r.saveBuyMonth === null ? 'تا ۱۰ سال نمی‌رسد' : r.saveBuyMonth === 0 ? 'همین الان' : `ماه ${faN(r.saveBuyMonth)}`}
              </dd>
              {r.savePriceThenRial ? (
                <dd className="fin-stat-sub">
                  به قیمت آن موقع <Money rial={r.savePriceThenRial} short />
                </dd>
              ) : null}
            </div>
          </dl>
          <p className={r.verdict === 'save' ? 'up' : r.verdict === 'loan' ? 'down' : ''} data-testid="goal-loan-verdict">
            {r.verdict === 'even' ? (
              <>در پایان {faN(n)} ماه دو راه تقریباً برابرند.</>
            ) : r.verdict === 'save' ? (
              <>
                با این عددها پس‌انداز به‌صرفه‌تر است: در پایان {faN(n)} ماه حدود <Money rial={r.diffRial} short /> بیشتر برایتان می‌ماند (در عوض کالا را دیرتر دارید).
              </>
            ) : (
              <>
                با این عددها وام به‌صرفه‌تر است: قیمت کالا از پس‌انداز جلو می‌زند و در پایان {faN(n)} ماه حدود <Money rial={-r.diffRial} short /> جلوترید (و کالا را از همین حالا دارید).
              </>
            )}
          </p>
          <p className="muted small">
            حساب: هر دو راه در هر ماه همان قسط را می‌پردازند و پس‌انداز فعلی هدف ({<Money rial={g.savedRial} short />}) در هر دو هست؛ مقایسه، پولی است که در پایان مدت وام می‌ماند. استفاده
            زودتر از کالا با وام قیمت‌گذاری نشده — آن را خودتان بسنجید. رشد قیمت پیش‌فرض {g.dk && productTrend(g) ? 'از روند قیمت خود همین کالا در دیجی‌کالا' : 'تورم تنظیمات'} است.
          </p>
        </div>
      )}
    </Disclosure>
  );
}

function Goals({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [date, setDate] = useState(addDays(today, 365));
  const [infl, setInfl] = useState(true);
  const [add, setAdd] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<DkProduct | null>(null);
  const [picker, setPicker] = useState(false);
  const { inflationPct, safeYieldPct } = d.settings;

  return (
    <>
      <PageHead title="اهداف پس‌انداز">
        خانه، خودرو، جهیزیه، سفر یا صندوق اضطراری. با تورم {fmtPctFa(inflationPct)} قیمت هدف تا آن روز بالا می‌رود؛ عددها این را حساب می‌کنند و نشان می‌دهند اگر پول را در صندوق درآمد ثابت (
        {fmtPctFa(safeYieldPct)}) بگذارید، ماهی چقدر کافی است. این دو عدد را در «تنظیمات ← محاسبات مالی» عوض کنید.
      </PageHead>

      {d.goals.length ? (
        d.goals.map((g) => {
          const growth = goalGrowth(g, inflationPct);
          const p = goalPlan(g, today, growth.pct, safeYieldPct);
          return (
            <Card
              key={g.id}
              title={g.name}
              action={
                <button className="fin-mini ghost" onClick={() => confirmDelete(`هدف «${g.name}»`) && update((dr) => void (dr.goals = dr.goals.filter((x) => x.id !== g.id)))}>
                  حذف
                </button>
              }
            >
              <Bar pct={p.progressPct} tone={p.reached ? 'ok' : 'warn'} />
              <dl className="fin-kpis tight">
                <div className="fin-stat">
                  <dt>پس‌انداز فعلی</dt>
                  <dd>
                    <Money rial={g.savedRial} short />
                  </dd>
                </div>
                <div className="fin-stat">
                  <dt>
                    {g.inflationAdjust
                      ? `هدف در ${fmtDateFa(g.targetDate)} (${growth.basis === 'product' ? `با روند قیمت این کالا، ${fmtPctFa(growth.pct, 0)} در سال` : 'با تورم'})`
                      : `هدف تا ${fmtDateFa(g.targetDate)}`}
                  </dt>
                  <dd>
                    <Money rial={p.futureTargetRial} short />
                  </dd>
                  {g.inflationAdjust ? (
                    <dd className="fin-stat-sub">
                      به پول امروز <Money rial={g.targetRial} short />
                    </dd>
                  ) : null}
                </div>
                <div className="fin-stat">
                  <dt>ماهانه، اگر پول بی‌سود بماند</dt>
                  <dd>
                    <Money rial={p.monthlyNoReturnRial} short />
                  </dd>
                </div>
                <div className="fin-stat">
                  <dt>ماهانه، در صندوق درآمد ثابت</dt>
                  <dd>
                    <Money rial={p.monthlyAtSafeYieldRial} short />
                  </dd>
                  <dd className="fin-stat-sub">
                    بازده واقعی صندوق: <span className={p.realSafeYieldPct < 0 ? 'down' : 'up'}>{fmtPctFa(p.realSafeYieldPct, 1)}</span>
                  </dd>
                </div>
              </dl>
              {p.reached ? <p className="up">به هدف رسیده‌اید.</p> : p.monthsLeft < 1 ? <p className="down">زمان هدف رسیده یا کمتر از یک ماه مانده.</p> : null}
              <GoalProductBox g={g} />
              <div className="fin-inline">
                <input
                  className="fin-input sm"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="تومان"
                  aria-label="مبلغ واریز به هدف"
                  value={add[g.id] ?? ''}
                  onChange={(e) => setAdd((x) => ({ ...x, [g.id]: e.target.value }))}
                />
                <button
                  className="fin-mini"
                  onClick={() => {
                    const t = parseAmount(add[g.id] ?? '');
                    if (!(t > 0)) return;
                    update((dr) => void (dr.goals.find((x) => x.id === g.id)!.savedRial += tomanToRial(t)));
                    setAdd((x) => ({ ...x, [g.id]: '' }));
                  }}
                >
                  افزودن به پس‌انداز
                </button>
                <button
                  className="fin-mini ghost"
                  onClick={() => {
                    const t = parseAmount(add[g.id] ?? '');
                    if (!(t > 0)) return;
                    update((dr) => {
                      const x = dr.goals.find((y) => y.id === g.id)!;
                      x.savedRial = Math.max(0, x.savedRial - tomanToRial(t));
                    });
                    setAdd((x) => ({ ...x, [g.id]: '' }));
                  }}
                >
                  برداشت
                </button>
              </div>
              {!p.reached ? <LoanCompare g={g} growthPct={growth.pct} safeYieldPct={safeYieldPct} /> : null}
            </Card>
          );
        })
      ) : (
        <Card>
          <Empty art="goals">هنوز هدفی ندارید.</Empty>
        </Card>
      )}

      <Disclosure label="+ هدف تازه" defaultOpen={!d.goals.length}>
        {(close) => (
          <div className="fin-grid">
            <TextInput label="عنوان" value={name} onChange={setName} placeholder="مثلاً پیش‌پرداخت خانه" />
            <div className="fin-span">
              <button className="fin-mini ghost" type="button" onClick={() => setPicker(true)} data-testid="goal-new-dk">
                <Glyph.Search size={14} aria-hidden="true" /> انتخاب کالا از دیجی‌کالا
              </button>
              {pick ? (
                <small className="muted" data-testid="goal-new-dk-pick">
                  {' '}
                  {pick.title}
                </small>
              ) : null}
              {picker ? (
                <DkPicker
                  query={name || 'یخچال'}
                  title="کالای هدف در دیجی‌کالا"
                  pickLabel="انتخاب برای این هدف"
                  onPick={(p) => {
                    setPick(p);
                    if (!name.trim()) setName(p.title.slice(0, 60));
                    if (p.priceRial) setTarget(String(Math.round(p.priceRial / 10)));
                  }}
                  onClose={() => setPicker(false)}
                />
              ) : null}
            </div>
            <TomanInput label="مبلغ هدف به پول امروز (تومان)" value={target} onChange={setTarget} />
            <TomanInput label="تا الان جمع کرده‌ام (تومان)" value={saved} onChange={setSaved} placeholder="۰" />
            <JalaliDate label="تاریخ هدف" value={date} onChange={setDate} yearsBack={0} yearsAhead={20} />
            <div className="fin-span">
              <Toggle checked={infl} onChange={setInfl}>
                قیمت هدف با تورم بالا می‌رود (برای خانه، خودرو، طلا روشن بگذارید)
              </Toggle>
            </div>
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  const t = parseAmount(target);
                  if (!name.trim() || !(t > 0) || date <= today) return;
                  update((dr) => {
                    const g: Goal = { id: newId('g'), name: name.trim(), targetRial: tomanToRial(t), savedRial: tomanToRial(parseAmount(saved) || 0), targetDate: date, inflationAdjust: infl };
                    if (pick) {
                      linkGoalProduct(g, pick);
                      // the user may have changed the amount: what they typed is the target until they turn «follow» on
                      if (g.targetRial !== tomanToRial(t)) {
                        g.targetRial = tomanToRial(t);
                        g.followPrice = false;
                      }
                    }
                    dr.goals.push(g);
                  });
                  setPick(null);
                  setName('');
                  setTarget('');
                  setSaved('');
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
    </>
  );
}

export default function GoalsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Goals d={d} />}</WithBook>
    </div>
  );
}
