// «وام خرید کالا یا پس‌انداز؟» (rule 105) — buy now with an installment loan (DigiPay and the like), or save the same
// installment every month and buy when the money is there. Both paths pay the same each month for the loan's term; the
// comparison is what each leaves at the end of it, in money of that month. The loan's use of the thing earlier is NOT
// priced: the page says so, and the user weighs it. The terms are the user's (the lender's real fee and rate are theirs
// to read off the contract); nothing here is a recommendation. Pure.

export type RateKind = 'flat' | 'declining';
export interface LoanInput {
  /** today's price */
  priceRial: number;
  /** what is already saved toward it */
  savedRial: number;
  /** paid now, % of the price */
  downPct: number;
  months: number;
  /** a year, % */
  ratePct: number;
  /** 'flat': the rate on the whole loan for the whole term (usual for shop installments); 'declining': on what is left (bank style) */
  rateKind: RateKind;
  /** how fast the price rises, a year, % */
  growthPct: number;
  /** what saved money earns, a year, % */
  saveYieldPct: number;
}

export function installment(loanRial: number, ratePct: number, months: number, kind: RateKind): number {
  if (!(loanRial > 0) || !(months >= 1)) return 0;
  if (kind === 'flat') return (loanRial * (1 + (ratePct / 100) * (months / 12))) / months;
  const r = ratePct / 100 / 12;
  return r > 0 ? (loanRial * r) / (1 - (1 + r) ** -months) : loanRial / months;
}

/** the yearly rate the loan really costs (the internal rate of its payments, compounded) */
export function effectiveAnnualPct(loanRial: number, monthly: number, months: number): number {
  if (!(loanRial > 0) || !(monthly > 0) || monthly * months <= loanRial) return 0;
  const pv = (i: number) => {
    let s = 0;
    for (let k = 1; k <= months; k++) s += monthly / (1 + i) ** k;
    return s;
  };
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 100; it++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > loanRial) lo = mid;
    else hi = mid;
  }
  return ((1 + (lo + hi) / 2) ** 12 - 1) * 100;
}

export interface LoanVsSave {
  downRial: number;
  loanRial: number;
  monthlyRial: number;
  totalPaidRial: number;
  interestRial: number;
  effectivePct: number;
  /** saving the same installment: the month it can be bought (0 = now), within 10 years, and its price then */
  saveBuyMonth: number | null;
  savePriceThenRial: number | null;
  /** money left at the end of the loan's term — after the loan (saved − down, grown) and after saving and buying */
  loanLeftRial: number;
  saveLeftRial: number;
  /** save − loan: > 0 saving leaves more; < 0 the loan does */
  diffRial: number;
  verdict: 'save' | 'loan' | 'even';
}

export function loanVsSave(inp: LoanInput): LoanVsSave {
  const n = Math.max(1, Math.round(inp.months));
  const down = Math.max(0, Math.min(1, inp.downPct / 100)) * inp.priceRial;
  const loan = inp.priceRial - down;
  const M = installment(loan, inp.ratePct, n, inp.rateKind);
  const s = (1 + inp.saveYieldPct / 100) ** (1 / 12) - 1;
  const priceAt = (k: number) => inp.priceRial * (1 + inp.growthPct / 100) ** (k / 12);
  const loanLeft = (inp.savedRial - down) * (1 + s) ** n;
  // saving the same installment
  let bal = inp.savedRial;
  let buy: number | null = null;
  let leftAtN = 0;
  if (bal >= priceAt(0)) {
    buy = 0;
    bal -= priceAt(0);
  }
  for (let k = 1; k <= 120; k++) {
    bal = bal * (1 + s) + M;
    if (buy === null && bal >= priceAt(k)) {
      buy = k;
      bal -= priceAt(k);
    }
    if (k === n) leftAtN = buy !== null ? bal : bal - priceAt(n);
    if (k >= n && buy !== null) break;
  }
  const diff = leftAtN - loanLeft;
  return {
    downRial: down,
    loanRial: loan,
    monthlyRial: M,
    totalPaidRial: down + M * n,
    interestRial: M * n - loan,
    effectivePct: effectiveAnnualPct(loan, M, n),
    saveBuyMonth: buy,
    savePriceThenRial: buy !== null ? priceAt(buy) : null,
    loanLeftRial: loanLeft,
    saveLeftRial: leftAtN,
    diffRial: diff,
    verdict: Math.abs(diff) < inp.priceRial * 0.01 ? 'even' : diff > 0 ? 'save' : 'loan',
  };
}
