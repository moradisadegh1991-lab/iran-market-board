// Iran's consumer prices, for «did it keep up with inflation?» (rule 83). The official series is the World Bank's
// FP.CPI.TOTL (CPI, 2010 = 100, yearly average; Statistical Centre / Central Bank of Iran data), last updated
// 2026-07-13 with 2025 the latest year. Each yearly average is placed at the middle of its year (1 July) and the index
// between two of them is interpolated in log (a constant monthly rate); after the last one it runs on at the user's own
// expected inflation (settings.inflationPct) — and every figure says which part was official and which assumed.
// Nothing here is a guess dressed as data: a period that starts before 2005 has no figure.
import type { Iso } from './model';

export const CPI_SOURCE = 'بانک جهانی، شاخص قیمت مصرف‌کننده ایران (میانگین سالانه، آخرین سال ۲۰۲۵)';
const CPI: [number, number][] = [
  [2005, 49.4108405341712],
  [2006, 54.3597800471328],
  [2007, 63.7863315003927],
  [2008, 79.9947630269704],
  [2009, 90.8352971982194],
  [2010, 100],
  [2011, 126.293385673861],
  [2012, 160.716937290151],
  [2013, 219.54421493168],
  [2014, 256.002941860307],
  [2015, 287.964093938751],
  [2016, 308.828317801683],
  [2017, 333.673322422363],
  [2018, 393.781629583152],
  [2019, 550.929425291206],
  [2020, 719.481539670071],
  [2021, 1031.65750196386],
  [2022, 1480.30950510605],
  [2023, 2140.21942916994],
  [2024, 2834.84629484158],
  [2025, 4030.3356899712],
];
const DAY = 86_400_000;
const mid = (y: number) => Date.UTC(y, 6, 1);
const ms = (iso: Iso) => Date.parse(`${iso}T00:00:00Z`);
/** the last day the official series covers (the middle of its last year) */
export const CPI_OFFICIAL_UNTIL: Iso = `${CPI[CPI.length - 1][0]}-07-01`;

/** log CPI on a day; after the official series, extended at `assumedPct` a year */
function logCpi(iso: Iso, assumedPct: number): number | null {
  const t = ms(iso);
  if (t < mid(CPI[0][0])) return null;
  for (let i = 1; i < CPI.length; i++) {
    const [y0, v0] = CPI[i - 1];
    const [y1, v1] = CPI[i];
    if (t <= mid(y1)) {
      const f = (t - mid(y0)) / (mid(y1) - mid(y0));
      return Math.log(v0) + f * (Math.log(v1) - Math.log(v0));
    }
  }
  const [yl, vl] = CPI[CPI.length - 1];
  return Math.log(vl) + ((t - mid(yl)) / (365.25 * DAY)) * Math.log(1 + assumedPct / 100);
}

export interface InflationSpan {
  /** consumer prices from `from` to `to`, percent */
  pct: number;
  /** how much of the span the official series covers: all, part (the rest at the user's rate), none */
  basis: 'official' | 'partly-assumed' | 'assumed';
  assumedPct: number;
}

export function inflationBetween(from: Iso, to: Iso, assumedPct: number): InflationSpan | null {
  const a = logCpi(from, assumedPct);
  const b = logCpi(to, assumedPct);
  if (a == null || b == null || to < from) return null;
  const basis = to <= CPI_OFFICIAL_UNTIL ? 'official' : from >= CPI_OFFICIAL_UNTIL ? 'assumed' : 'partly-assumed';
  return { pct: (Math.exp(b - a) - 1) * 100, basis, assumedPct };
}
