/**
 * Memory for the swing engine.
 *
 * Every swing run (single coin, basket, or auto-scan) is recorded, and the records are
 * aggregated into a per-coin prior: how this coin has actually behaved for this strategy in
 * the past. The auto-scan then blends that prior into its ranking.
 *
 * The prior is deliberately weak and shrunk toward "no opinion":
 *  - a coin with two recorded runs barely moves the ranking, one with many moves it more;
 *  - the blend is capped, so history can reorder near-ties but can never overrule what the
 *    current data says.
 * Without that, the engine would simply keep picking whatever won last time, which is the
 * same selection bias the scan's train/test split exists to avoid.
 */
import { kv } from '@/lib/store';

const RUNS_KEY = 'swing:runs:v1';
const MAX_RUNS = 400;

export interface SwingRunRecord {
  at: number;
  /** how the run was started */
  source: 'single' | 'basket' | 'scan' | 'live';
  coinId: string;
  symbol: string;
  preset: string;
  days: number;
  feePct: number;
  returnPct: number;
  buyHoldPct: number;
  trades: number;
  winRatePct: number | null;
  maxDrawdownPct: number;
  /** window the run covered, so the same period isn't counted twice */
  from: number | null;
  to: number | null;
}

export interface CoinPrior {
  coinId: string;
  symbol: string;
  runs: number;
  totalTrades: number;
  meanReturnPct: number;
  meanEdgePct: number; // return minus buy & hold
  meanWinRatePct: number | null;
  lastAt: number;
  /** −1..+1, shrunk by how little evidence there is */
  score: number;
}

export async function getSwingRuns(): Promise<SwingRunRecord[]> {
  return (await kv.get<SwingRunRecord[]>(RUNS_KEY).catch(() => null)) ?? [];
}

/** Append runs, newest first, de-duplicating identical coin+preset+window repeats. */
export async function recordSwingRuns(records: SwingRunRecord[]): Promise<void> {
  if (!records.length) return;
  const existing = await getSwingRuns();
  const seen = new Set(existing.map((r) => `${r.coinId}|${r.preset}|${r.from}|${r.to}|${r.days}`));
  const fresh = records.filter((r) => {
    const k = `${r.coinId}|${r.preset}|${r.from}|${r.to}|${r.days}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return;
  const merged = [...fresh, ...existing].slice(0, MAX_RUNS);
  await kv.set(RUNS_KEY, merged, 365 * 86400).catch(() => {});
}

export async function clearSwingRuns(): Promise<void> {
  await kv.del(RUNS_KEY).catch(() => {});
}

/**
 * Per-coin priors from the stored runs.
 * The headline number is "edge" (strategy return minus buy & hold), not raw return: a coin
 * that returned 40% in a month when simply holding it returned 60% was a bad swing vehicle,
 * and ranking on raw return would have promoted it.
 */
export function buildPriors(runs: SwingRunRecord[]): Map<string, CoinPrior> {
  const byCoin = new Map<string, SwingRunRecord[]>();
  for (const r of runs) {
    if (!byCoin.has(r.coinId)) byCoin.set(r.coinId, []);
    byCoin.get(r.coinId)!.push(r);
  }
  const out = new Map<string, CoinPrior>();
  for (const [coinId, rs] of byCoin) {
    const n = rs.length;
    const mean = (f: (r: SwingRunRecord) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
    const meanEdgePct = mean((r) => r.returnPct - r.buyHoldPct);
    const wr = rs.map((r) => r.winRatePct).filter((v): v is number => v !== null);
    // shrink toward zero: with few runs we have almost no evidence
    const confidence = n / (n + 4);
    const raw = Math.max(-1, Math.min(1, meanEdgePct / 15));
    out.set(coinId, {
      coinId,
      symbol: rs[0].symbol,
      runs: n,
      totalTrades: rs.reduce((a, r) => a + r.trades, 0),
      meanReturnPct: mean((r) => r.returnPct),
      meanEdgePct,
      meanWinRatePct: wr.length ? wr.reduce((a, v) => a + v, 0) / wr.length : null,
      lastAt: Math.max(...rs.map((r) => r.at)),
      score: raw * confidence,
    });
  }
  return out;
}

/** How much a prior may move a scan score. Small on purpose — see the file header. */
export const PRIOR_WEIGHT = 0.35;
