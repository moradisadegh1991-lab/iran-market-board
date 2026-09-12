// Deterministic fingerprint of the pure trading engine. Refactors of lib/engine/simulator.ts must keep the
// default-parameter output byte-identical. Run: npx tsx scripts/sim-regression.ts
import { createHash } from 'node:crypto';
import { simulate, type SimAsset, type SimInput, type ScoredNews } from '@/lib/engine/simulator';

let seed = 1234;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const iso = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);

function regimes(n: number, start: number, sigma: number, drifts: number[], skipFridays = true) {
  const dates: string[] = [];
  const prices: number[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const mu = drifts[Math.floor((i / n) * drifts.length)];
    p *= Math.exp(mu - sigma ** 2 / 2 + sigma * gauss());
    const d = iso(i);
    if (skipFridays && new Date(`${d}T00:00:00Z`).getUTCDay() === 5) continue;
    dates.push(d);
    prices.push(p);
  }
  return { dates, prices };
}

const N = 520;
const mk = (key: SimAsset, s: { dates: string[]; prices: number[] }, reconstructed = false) => ({ key, ...s, basis: 'test', reconstructed });
const usd = regimes(N, 700_000, 0.012, [0.002, 0.0005, 0.003, -0.001, 0.0015]);
const ons = regimes(N, 2400, 0.009, [0.001, 0.0005, 0.0012, 0.0, 0.001]);
const series = {
  usd: mk('usd', usd),
  g18: mk('g18', regimes(N, 50_000_000, 0.013, [0.0015, 0.0, 0.0025, 0.0005, 0.002])),
  coin: mk('coin', regimes(N, 500_000_000, 0.015, [0.002, -0.001, 0.003, 0.0, 0.002])),
  tse: mk('tse', regimes(N, 2_000_000, 0.011, [0.003, -0.002, 0.001, 0.004, -0.001])),
  btc: mk('btc', regimes(N, 4e10, 0.03, [0.003, -0.002, 0.004, 0.0, -0.001], false), true),
  eth: mk('eth', regimes(N, 2e9, 0.035, [0.002, -0.003, 0.005, -0.001, 0.001], false), true),
};

const news: ScoredNews[] = Array.from({ length: 60 }, (_, i) => {
  const day = 150 + i * 6;
  const d = iso(day);
  const sign = rnd() > 0.5 ? 1 : -1;
  return {
    id: `n${i}`, date: d, ms: Date.parse(`${d}T08:00:00Z`), title: `خبر آزمایشی ${i}`, source: 'test', url: `https://x/${i}`,
    effects: { usd: sign * 0.7, coin: sign * 0.6, g18: sign * 0.4, btc: -sign * 0.3 }, facts: [i % 3 ? 'تحریم' : 'مذاکره'], weight: 0.6 + rnd() * 0.5,
  };
});

export function regressionInput(overrides: Partial<SimInput> = {}): SimInput {
  return {
    start: iso(200), end: iso(500), capitalToman: 500_000_000, profile: 'balanced', assets: ['usd', 'g18', 'coin', 'tse', 'btc', 'eth'],
    fixedIncomeYield: 0.3, series, ons, usdRef: usd, news, ...overrides,
  };
}

export function fingerprint(input: SimInput, params?: unknown) {
  const r = (simulate as any)(input, params);
  const core = { m: r.metrics, t: r.trades.map((t: any) => ({ ...t, components: undefined, paramsVersion: undefined })), e: r.equity, b: r.benchmarks, a: r.attribution };
  return { hash: createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16), r };
}

if (process.argv[1]?.includes('sim-regression')) {
  for (const profile of ['conservative', 'balanced', 'aggressive'] as const) {
    const { hash, r } = fingerprint(regressionInput({ profile }));
    console.log(profile, hash, `trades=${r.trades.length}`, `ret=${r.metrics.returnPct.toFixed(3)}%`);
  }
  const { hash, r } = fingerprint(regressionInput({ news: [] }));
  console.log('no-news', hash, `trades=${r.trades.length}`, `ret=${r.metrics.returnPct.toFixed(3)}%`);
}
