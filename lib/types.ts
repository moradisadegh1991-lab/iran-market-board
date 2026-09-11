export type HorizonKey = 'd1' | 'w1' | 'm1' | 'm3' | 'm6' | 'y1';
export type AssetKey = 'usd' | 'usdt' | 'g18' | 'coin' | 'ons' | 'btc' | 'eth' | 'tse';
export type RiskAssetKey = AssetKey | 'btc_irt';
export type Profile = 'conservative' | 'balanced' | 'aggressive';
export type PortfolioHorizon = 'm1' | 'm3' | 'm6' | 'y1';

export interface SourceStatus {
  name: string;
  label: string;
  ok: boolean;
  stale: boolean;
  ageSec: number | null;
  via: 'fetch' | 'ingest' | 'none';
  error?: string;
}

export interface BoardItem {
  key: string;
  label: string;
  price: number | null; // display unit
  unit: 'toman' | 'usd' | 'point';
  changePct: number | null;
  note?: string;
}

export interface LiveBoard {
  items: BoardItem[];
  coinBubblePct: number | null;
  g18BubblePct: number | null;
  usdtPremiumPct: number | null;
}

export interface HorizonRisk {
  buy: number;
  hold: number;
  sell: number;
  pDown: number;
  pUp: number;
  expReturnPct: number;
  rangeLow: number;
  rangeHigh: number;
  confidence: number; // 0..1
  signal: 'entry-low' | 'entry-high' | 'neutral';
}

export interface AssetRisk {
  key: RiskAssetKey;
  label: string;
  unit: 'toman' | 'usd' | 'point';
  price: number | null;
  points: number;
  firstDate: string | null;
  annualVolPct: number | null;
  horizons: Record<HorizonKey, HorizonRisk | null>;
  hidden?: boolean;
  basis?: string; // where the long history comes from
}

export type ScenarioGroup = 'fx' | 'gold' | 'crypto' | 'tse' | 'alt';

export interface ScenarioRow {
  h: HorizonKey;
  label: string;
  days: number;
  worst: number;
  base: number;
  best: number;
  worstPct: number;
  basePct: number;
  bestPct: number;
  histWorstPct: number | null;
  histBestPct: number | null;
  confidence: number; // 0..1
}

export interface AssetScenario {
  key: string;
  label: string;
  symbol?: string;
  unit: 'toman' | 'usd' | 'point';
  group: ScenarioGroup;
  price: number | null;
  points: number;
  basis: string;
  annualVolPct: number | null;
  rows: Record<HorizonKey, ScenarioRow | null>;
  drivers: string[];
  summary: string;
  missingReason?: string;
}

export interface CryptoRow {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  image?: string;
  price: number;
  mcap: number;
  m24: number | null;
  m7: number | null;
  m30: number | null;
  turnoverPct: number;
  weeklyVolPct: number | null;
  score: number;
  riskWeek: number | null;
  reasons: string[];
  spark: number[];
  onNobitex: boolean | null;
}

export interface StockRow {
  rank: number;
  symbol: string;
  name: string;
  price: number | null; // rial
  chgToday: number | null;
  r20: number | null;
  r60: number | null;
  volSurge: number | null;
  pe: number | null;
  sector: string | null;
  score: number;
  riskMonth: number | null;
  reasons: string[];
  flags: string[];
}

export interface AllocationLine {
  cls: 'cash' | 'usd' | 'gold' | 'equity' | 'btc' | 'spec';
  label: string;
  weight: number; // 0..1
  baseWeight: number;
  instrument: string;
  rationale: string;
}

export interface Portfolio {
  profile: Profile;
  horizon: PortfolioHorizon;
  lines: AllocationLine[];
  annualVolPct: number | null;
  varPct: number | null; // 95% horizon loss estimate (positive number)
  notes: string[];
}

export interface Snapshot {
  version: 2;
  generatedAt: string;
  storeMode: 'redis' | 'memory';
  sources: SourceStatus[];
  live: LiveBoard;
  risk: AssetRisk[];
  crypto: { coins: CryptoRow[]; memes: CryptoRow[]; note: string };
  stocks: { rows: StockRow[]; mode: 'history' | 'warmup' | 'unavailable'; historyDays: number; note: string };
  scenarios: { assets: AssetScenario[]; note: string };
  portfolios: Record<Profile, Record<PortfolioHorizon, Portfolio>>;
  defaultProfile: Profile;
}
