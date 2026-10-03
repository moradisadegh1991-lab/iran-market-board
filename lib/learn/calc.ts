// The arithmetic behind the learning section's small calculators — pure, so the test can pin it.

/** Future value of `initial` plus `monthly` deposits for `years` at `annualPct`, compounded monthly; and the same in today's money. */
export function compound(initial: number, monthly: number, annualPct: number, years: number, inflationPct: number): { nominal: number; real: number; deposited: number } {
  const n = Math.round(years * 12);
  const rm = (1 + annualPct / 100) ** (1 / 12) - 1;
  const g = (1 + rm) ** n;
  const nominal = initial * g + (rm === 0 ? monthly * n : (monthly * (g - 1)) / rm);
  return { nominal, real: nominal / (1 + inflationPct / 100) ** years, deposited: initial + monthly * n };
}

/** Years until prices double at `inflationPct` a year (exact, not the rule of 70). */
export const doublingYears = (inflationPct: number) => (inflationPct > 0 ? Math.log(2) / Math.log(1 + inflationPct / 100) : Infinity);

/** What a price becomes after `years` of inflation, and what today's amount still buys then (in today's prices). */
export function inflate(amount: number, inflationPct: number, years: number): { future: number; buys: number } {
  const k = (1 + inflationPct / 100) ** years;
  return { future: amount * k, buys: amount / k };
}

/** Volatility of a half-and-half mix of two assets with the same volatility and correlation `rho`. */
export const mixVol = (vol: number, rho: number) => vol * Math.sqrt((1 + Math.max(-1, Math.min(1, rho))) / 2);

/** Position size from the risk budget: (capital × risk%) ÷ the distance from entry to stop. */
export function positionSize(capital: number, riskPct: number, entry: number, stop: number): { size: number; units: number; riskAmount: number; stopPct: number } | null {
  if (!(capital > 0 && riskPct > 0 && entry > 0 && stop > 0 && stop < entry)) return null;
  const riskAmount = (capital * riskPct) / 100;
  const stopPct = (entry - stop) / entry;
  const size = Math.min(capital, riskAmount / stopPct);
  return { size, units: size / entry, riskAmount, stopPct: stopPct * 100 };
}

/** The 50 / 30 / 20 split of a monthly income. */
export const split503020 = (income: number) => ({ needs: income * 0.5, wants: income * 0.3, save: income * 0.2 });

/** A price in hours of work. */
export const workHours = (price: number, monthlyIncome: number, hoursPerMonth: number) => (monthlyIncome > 0 && hoursPerMonth > 0 ? price / (monthlyIncome / hoursPerMonth) : null);
