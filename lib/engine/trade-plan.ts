/** Spot long trade, monetary inputs in the same currency, costs in percent per side. */
export function tradePlan(x: { capital: number; entry: number; stop: number; target: number; fee: number; slippage: number; riskPct: number; maxPositionPct: number }) {
  if (!Object.values(x).every(Number.isFinite) || x.capital <= 0 || x.entry <= 0 || x.stop <= 0 || x.stop >= x.entry || x.target <= x.entry || x.fee < 0 || x.fee > 10 || x.slippage < 0 || x.slippage > 20 || x.riskPct <= 0 || x.riskPct > 10 || x.maxPositionPct <= 0 || x.maxPositionPct > 100) return null;
  const buy = x.entry * (1 + x.slippage / 100) * (1 + x.fee / 100);
  const stopSell = x.stop * (1 - x.slippage / 100) * (1 - x.fee / 100);
  const targetSell = x.target * (1 - x.slippage / 100) * (1 - x.fee / 100);
  const lossPerUnit = buy - stopSell, profitPerUnit = targetSell - buy;
  const qty = Math.min(x.capital * x.riskPct / 100 / lossPerUnit, x.capital * x.maxPositionPct / 100 / buy);
  const loss = qty * lossPerUnit, profit = qty * profitPerUnit;
  return { qty, investment: qty * buy, loss, profit, breakEvenPrice: buy / ((1 - x.slippage / 100) * (1 - x.fee / 100)), rewardRisk: profit / loss, breakEvenWinRate: profit > 0 ? loss / (loss + profit) * 100 : null, targetViable: profit > 0 };
}
