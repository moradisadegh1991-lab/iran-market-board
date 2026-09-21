/**
 * Position sizing — how much to buy, given what you are willing to lose.
 *
 * Every other engine here answers "what looks good". None of them answered the question that
 * actually decides whether an account survives a bad run: how large may this position be?
 * A trader with a 50% edge and no sizing rule still goes broke; a trader with a weak edge and a
 * fixed 1% risk per trade does not.
 *
 * The rule implemented is the standard one: fix the money lost when the stop fills, then let the
 * distance to the stop decide the quantity. A far stop means a small position, a near stop a
 * larger one — the risk stays the same either way, which is the point.
 *
 * Long-only and spot-only, matching the rest of this project. Costs are charged on both legs,
 * because a stop that looks like −3% is −3.8% after a 0.4%-per-side round trip and the account
 * loses the difference regardless of what the chart said.
 *
 * Pure: no I/O, no clock.
 */
import { clamp, isNum } from '@/lib/num';

/** Persian digits in the engine's own sentences, so they match the numbers around them in the UI. */
const fa = (n: number, digits = 1) => n.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fa0 = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 0 });

export interface SizingInput {
  capitalToman: number;
  /** share of capital to put at risk on this one trade (1 = the classic 1% rule) */
  riskPctPerTrade: number;
  entryPrice: number; // any unit; only ratios are used
  stopPrice: number;
  targetPrice?: number | null;
  /** exchange fee + spread, per side, in percent */
  feePctPerSide: number;
  /** ceiling on what one position may occupy, % of capital */
  maxPositionPct?: number;
  /** risk already committed to other open positions, % of capital */
  openRiskPct?: number;
  /** measured behaviour of the strategy, for the Kelly cross-check */
  edge?: { winRatePct: number; payoffRatio: number } | null;
  /** annualised volatility of the asset (%), to judge whether the stop is inside the noise */
  annualVolPct?: number | null;
  /** how long the trade is meant to last, same purpose */
  holdDays?: number | null;
}

export interface SizingResult {
  ok: boolean;
  reason?: string;
  /** distance from entry to stop, % of entry, before costs */
  stopDistancePct: number;
  /** money actually lost per unit if the stop fills, costs included */
  lossPerUnit: number;
  qty: number;
  positionToman: number;
  positionPct: number;
  /** what is really at risk after any cap bit — may be below the requested risk */
  riskToman: number;
  riskPct: number;
  /** reward ÷ risk to the target, costs included */
  rMultiple: number | null;
  /** win rate this trade needs just to break even at that R */
  breakEvenWinRatePct: number | null;
  kelly: { fullPct: number; halfPct: number; verdict: string } | null;
  /** which constraint decided the size */
  cappedBy: 'risk' | 'position' | 'capital' | null;
  stopVsNoise: { expectedMovePct: number; ratio: number; verdict: string } | null;
  warnings: string[];
}

const MAX_POSITION_DEFAULT = 25;

export function sizePosition(inp: SizingInput): SizingResult {
  const warnings: string[] = [];
  const fail = (reason: string): SizingResult => ({
    ok: false, reason, stopDistancePct: 0, lossPerUnit: 0, qty: 0, positionToman: 0, positionPct: 0,
    riskToman: 0, riskPct: 0, rMultiple: null, breakEvenWinRatePct: null, kelly: null, cappedBy: null,
    stopVsNoise: null, warnings,
  });

  const { capitalToman: capital, entryPrice: entry, stopPrice: stop } = inp;
  if (!isNum(capital) || capital <= 0) return fail('سرمایه باید عددی مثبت باشد.');
  if (!isNum(entry) || entry <= 0) return fail('قیمت ورود باید عددی مثبت باشد.');
  if (!isNum(stop) || stop <= 0) return fail('حد ضرر باید عددی مثبت باشد.');
  if (stop >= entry) return fail('حد ضرر باید پایین‌تر از قیمت ورود باشد (این ابزار فقط برای خرید است، نه فروش استقراضی).');

  const riskPct = clamp(isNum(inp.riskPctPerTrade) ? inp.riskPctPerTrade : 1, 0.05, 100);
  const fee = clamp(isNum(inp.feePctPerSide) ? inp.feePctPerSide : 0, 0, 5) / 100;
  const maxPosPct = clamp(isNum(inp.maxPositionPct) ? inp.maxPositionPct : MAX_POSITION_DEFAULT, 1, 100);

  const stopDistancePct = (1 - stop / entry) * 100;
  // what the account really loses per unit: bought with the fee on top, sold with the fee taken off
  const buyCost = entry * (1 + fee);
  const stopProceeds = stop * (1 - fee);
  const lossPerUnit = buyCost - stopProceeds;
  if (lossPerUnit <= 0) return fail('با این کارمزد و فاصله حد ضرر، محاسبه معنا ندارد.');

  const riskBudget = capital * (riskPct / 100);
  let qty = riskBudget / lossPerUnit;
  let positionToman = qty * buyCost;
  let cappedBy: SizingResult['cappedBy'] = 'risk';

  const posCeiling = capital * (maxPosPct / 100);
  if (positionToman > posCeiling) {
    positionToman = posCeiling;
    qty = positionToman / buyCost;
    cappedBy = 'position';
    warnings.push(
      `فاصله حد ضرر (${fa(stopDistancePct)}٪) آن‌قدر نزدیک است که رعایت ریسک ${fa(riskPct)}٪ به موقعیتی بزرگ‌تر از سقف ${fa0(maxPosPct)}٪ سرمایه نیاز دارد. ` +
        'حجم به سقف محدود شد؛ یعنی ریسک واقعی این معامله کمتر از عدد درخواستی است.',
    );
  }
  if (positionToman > capital) {
    positionToman = capital;
    qty = positionToman / buyCost;
    cappedBy = 'capital';
  }

  const riskToman = qty * lossPerUnit;

  // reward side
  let rMultiple: number | null = null;
  let breakEvenWinRatePct: number | null = null;
  if (isNum(inp.targetPrice) && inp.targetPrice! > 0) {
    const gainPerUnit = inp.targetPrice! * (1 - fee) - buyCost;
    rMultiple = gainPerUnit / lossPerUnit;
    if (rMultiple > 0) breakEvenWinRatePct = (1 / (1 + rMultiple)) * 100;
    if (rMultiple <= 1) {
      warnings.push(
        `نسبت سود به زیان ${fa(rMultiple, 2)} است؛ یعنی برای سر‌به‌سر شدن باید بیش از ${fa0(breakEvenWinRatePct ?? 50)}٪ معامله‌ها برنده باشد. ` +
          'با کارمزد بازار ایران، معامله‌ای با نسبت کمتر از ۱٫۵ معمولاً ارزش ریسک را ندارد.',
      );
    }
  }

  // Kelly cross-check — expressed as a risk-per-trade percentage, which is what Kelly's f*
  // actually is: the fraction of the bankroll placed on the losing outcome.
  let kelly: SizingResult['kelly'] = null;
  if (inp.edge && isNum(inp.edge.winRatePct) && isNum(inp.edge.payoffRatio) && inp.edge.payoffRatio > 0) {
    const w = clamp(inp.edge.winRatePct / 100, 0, 1);
    const b = inp.edge.payoffRatio;
    const full = w - (1 - w) / b;
    const fullPct = full * 100;
    const halfPct = (full / 2) * 100;
    const verdict =
      full <= 0
        ? 'با این نرخ برد و این نسبت سود به زیان، فرمول کِلی می‌گوید این معامله اصلاً نباید انجام شود — امید ریاضی آن منفی است.'
        : riskPct > halfPct
          ? `ریسک انتخابی (${fa(riskPct)}٪) از نصف کِلی (${fa(halfPct)}٪) بیشتر است؛ با این اندازه، یک دوره بد می‌تواند سرمایه را به‌شدت کم کند.`
          : `ریسک انتخابی (${fa(riskPct)}٪) زیر نصف کِلی (${fa(halfPct)}٪) است؛ محافظه‌کارانه و قابل دفاع.`;
    kelly = { fullPct, halfPct, verdict };
    if (full <= 0) warnings.push('امید ریاضی این استراتژی با آمار واردشده منفی است.');
  }

  // Is the stop inside the asset's normal noise? A stop tighter than the move the asset makes
  // anyway will be hit by nothing in particular, turning a real edge into a stream of small losses.
  let stopVsNoise: SizingResult['stopVsNoise'] = null;
  if (isNum(inp.annualVolPct) && inp.annualVolPct! > 0 && isNum(inp.holdDays) && inp.holdDays! > 0) {
    const expectedMovePct = inp.annualVolPct! * Math.sqrt(inp.holdDays! / 365);
    const ratio = stopDistancePct / expectedMovePct;
    const verdict =
      ratio < 0.7
        ? `حد ضرر (${fa(stopDistancePct)}٪) از نوسان معمول این دارایی در ${fa0(inp.holdDays!)} روز (${fa(expectedMovePct)}٪) کمتر است؛ احتمالاً با نوسان عادی و بدون هیچ دلیل خاصی فعال می‌شود.`
        : ratio > 3
          ? `حد ضرر (${fa(stopDistancePct)}٪) خیلی دورتر از نوسان معمول (${fa(expectedMovePct)}٪) است؛ حجم معامله را بی‌دلیل کوچک می‌کند.`
          : `فاصله حد ضرر با نوسان معمول این دارایی (${fa(expectedMovePct)}٪ در ${fa0(inp.holdDays!)} روز) متناسب است.`;
    stopVsNoise = { expectedMovePct, ratio, verdict };
    if (ratio < 0.7) warnings.push('حد ضرر در محدوده نوسان طبیعی قیمت است.');
  }

  const openRisk = isNum(inp.openRiskPct) ? Math.max(0, inp.openRiskPct) : 0;
  const totalRisk = openRisk + (riskToman / capital) * 100;
  if (totalRisk > 6) {
    warnings.push(
      `با احتساب موقعیت‌های باز، مجموع ریسک همزمان ${fa(totalRisk)}٪ سرمایه می‌شود. ` +
        'اگر دارایی‌ها هم‌جهت باشند — که در بازار ایران معمولاً هستند — این ریسک‌ها با هم جمع می‌شوند، نه اینکه همدیگر را خنثی کنند.',
    );
  }

  return {
    ok: true,
    stopDistancePct,
    lossPerUnit,
    qty,
    positionToman,
    positionPct: (positionToman / capital) * 100,
    riskToman,
    riskPct: (riskToman / capital) * 100,
    rMultiple,
    breakEvenWinRatePct,
    kelly,
    cappedBy,
    stopVsNoise,
    warnings,
  };
}

/**
 * How many losing trades in a row the account can take at this risk level before it is down
 * by `drawdownPct`. Sizing arguments are abstract until you see this number.
 */
export function lossesToDrawdown(riskPctPerTrade: number, drawdownPct = 20): number {
  const r = clamp(riskPctPerTrade, 0.01, 99) / 100;
  const d = clamp(drawdownPct, 1, 99) / 100;
  return Math.ceil(Math.log(1 - d) / Math.log(1 - r));
}
