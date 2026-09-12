// Persistence for the learning loop. The learned parameters are global (one engine), so only admin-authorised
// runs and live sessions started by the admin may update them; public visitors only *use* them.
import { kv } from '@/lib/store';
import { DEFAULT_PARAMS, PriceBook, normalizeParams, type SimAsset, type SimParams, type SimProfile, type SimResult, type SimSeries } from '@/lib/engine/simulator';
import { learnFromResult, type LearnOutcome, type PriceLookup } from '@/lib/engine/learning';

const PARAMS_KEY = 'learn:params:v1';
const LOG_KEY = 'learn:log:v1';
const DAYS_KEY = 'learn:days:v1';
const LOCK_KEY = 'learn:lock';
const MAX_LOG = 40;

export interface LearnLogEntry {
  at: string;
  source: 'backtest' | 'live' | 'reset';
  label: string;
  profile: SimProfile | null;
  assets: SimAsset[];
  window: [string, string] | null;
  returnPct: number | null;
  applied: boolean;
  reason: string | null;
  fromVersion: number;
  toVersion: number;
  newFraction: number;
  closedRoundTrips: number;
  lessons: LearnOutcome['lessons'];
  deltas: LearnOutcome['deltas'];
}

export async function getLearnedParams(): Promise<SimParams> {
  return normalizeParams(await kv.get<SimParams>(PARAMS_KEY).catch(() => null));
}

export async function getLearningState() {
  const [params, log, days] = await Promise.all([getLearnedParams(), kv.get<LearnLogEntry[]>(LOG_KEY), kv.get<string[]>(DAYS_KEY)]);
  return { params, defaults: DEFAULT_PARAMS, log: log ?? [], learnedDays: days?.length ?? 0 };
}

async function learnedDaySet(): Promise<Set<string>> {
  return new Set((await kv.get<string[]>(DAYS_KEY)) ?? []);
}

/** Share of the run's calendar days that were never learned from before (0..1). */
export async function noveltyOf(result: SimResult): Promise<{ newFraction: number; overlapFraction: number }> {
  const days = [...new Set(result.equity.map((e) => e.date))];
  if (!days.length) return { newFraction: 0, overlapFraction: 0 };
  const seen = await learnedDaySet();
  const fresh = days.filter((d) => !seen.has(d)).length;
  return { newFraction: fresh / days.length, overlapFraction: 1 - fresh / days.length };
}

export function lookupFromSeries(series: Partial<Record<SimAsset, Pick<SimSeries, 'dates' | 'prices'>>>): PriceLookup {
  const books = new Map<SimAsset, PriceBook>();
  for (const [k, s] of Object.entries(series)) if (s?.dates.length) books.set(k as SimAsset, new PriceBook(s.dates, s.prices));
  return {
    after(asset, date, sessions) {
      const b = books.get(asset);
      if (!b) return [];
      const i = b.lastIdx(date);
      return b.prices.slice(i + 1, i + 1 + sessions);
    },
  };
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 20; i++) {
    if (await kv.setNx(LOCK_KEY, Date.now(), 30)) {
      try {
        return await fn();
      } finally {
        await kv.del(LOCK_KEY).catch(() => undefined);
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('به‌روزرسانی موتور هم‌زمان در حال انجام است؛ کمی بعد دوباره تلاش کنید.');
}

/** Learn from a finished run and persist. Always logs the outcome, even when nothing changed. */
export async function applyLearning(result: SimResult, lookup: PriceLookup, source: 'backtest' | 'live', label: string): Promise<LearnOutcome> {
  return withLock(async () => {
    const current = await getLearnedParams();
    const { newFraction } = await noveltyOf(result);
    const outcome = learnFromResult(current, result, lookup, newFraction);
    if (outcome.applied) {
      await kv.set(PARAMS_KEY, outcome.after);
      // only days that actually taught the engine are marked as used
      const seen = await learnedDaySet();
      for (const e of result.equity) seen.add(e.date);
      await kv.set(DAYS_KEY, [...seen].sort().slice(-2000));
    }
    const log = (await kv.get<LearnLogEntry[]>(LOG_KEY)) ?? [];
    log.unshift({
      at: new Date().toISOString(), source, label, profile: result.input.profile, assets: result.input.assets,
      window: [result.input.start, result.input.end], returnPct: result.metrics.returnPct,
      applied: outcome.applied, reason: outcome.reason, fromVersion: outcome.before.version, toVersion: outcome.after.version,
      newFraction: outcome.newFraction, closedRoundTrips: outcome.closedRoundTrips, lessons: outcome.lessons, deltas: outcome.deltas,
    });
    await kv.set(LOG_KEY, log.slice(0, MAX_LOG));
    return outcome;
  });
}

export async function resetLearning(): Promise<void> {
  await withLock(async () => {
    const current = await getLearnedParams();
    await kv.del(PARAMS_KEY);
    await kv.del(DAYS_KEY);
    const log = (await kv.get<LearnLogEntry[]>(LOG_KEY)) ?? [];
    log.unshift({
      at: new Date().toISOString(), source: 'reset', label: 'بازنشانی به قواعد پایه', profile: null, assets: [], window: null, returnPct: null,
      applied: true, reason: null, fromVersion: current.version, toVersion: 0, newFraction: 0, closedRoundTrips: 0, lessons: [], deltas: [],
    });
    await kv.set(LOG_KEY, log.slice(0, MAX_LOG));
  });
}
