// Strategic anchor weights (editable) + tactical tilt from horizon risk scores + caps → allocation per profile/horizon
import { clamp, fmtInt, fmtNum, fmtPct, isNum } from '@/lib/num';
import type { AllocationLine, AssetRisk, CryptoRow, LiveBoard, Portfolio, PortfolioHorizon, Profile, RiskAssetKey } from '@/lib/types';

type Cls = AllocationLine['cls'];
const CLASSES: Cls[] = ['cash', 'usd', 'gold', 'equity', 'btc', 'spec'];

export const PROFILE_LABEL: Record<Profile, string> = { conservative: 'محتاط', balanced: 'متعادل', aggressive: 'جسور' };
export const HORIZON_LABEL: Record<PortfolioHorizon, string> = { m1: '۱ ماهه', m3: '۳ ماهه', m6: '۶ ماهه', y1: 'سالانه' };
const CLASS_LABEL: Record<Cls, string> = {
  cash: 'درآمد ثابت ریالی',
  usd: 'دلار / تتر',
  gold: 'طلا',
  equity: 'سهام بورس',
  btc: 'بیت‌کوین / اتریوم',
  spec: 'آلت‌کوین پرریسک',
};

// order: cash, usd, gold, equity, btc, spec
const ANCHOR: Record<Profile, Record<PortfolioHorizon, number[]>> = {
  conservative: { m1: [0.55, 0.2, 0.2, 0.05, 0, 0], m3: [0.45, 0.2, 0.25, 0.1, 0, 0], m6: [0.35, 0.2, 0.3, 0.12, 0.03, 0], y1: [0.3, 0.18, 0.32, 0.15, 0.05, 0] },
  balanced: { m1: [0.35, 0.2, 0.25, 0.12, 0.06, 0.02], m3: [0.28, 0.18, 0.28, 0.16, 0.08, 0.02], m6: [0.22, 0.17, 0.3, 0.19, 0.1, 0.02], y1: [0.18, 0.15, 0.3, 0.23, 0.12, 0.02] },
  aggressive: { m1: [0.2, 0.15, 0.25, 0.2, 0.14, 0.06], m3: [0.15, 0.13, 0.25, 0.25, 0.16, 0.06], m6: [0.1, 0.12, 0.25, 0.29, 0.18, 0.06], y1: [0.08, 0.1, 0.24, 0.32, 0.2, 0.06] },
};
const CAP: Record<Profile, Partial<Record<Cls, number>>> = {
  conservative: { equity: 0.2, btc: 0.06, spec: 0 },
  balanced: { equity: 0.3, btc: 0.14, spec: 0.03 },
  aggressive: { equity: 0.4, btc: 0.22, spec: 0.07 },
};
const CASH_MIN: Record<Profile, number> = { conservative: 0.2, balanced: 0.08, aggressive: 0.04 };
const RISK_KEY: Record<Cls, RiskAssetKey | null> = { cash: null, usd: 'usdt', gold: 'g18', equity: 'tse', btc: 'btc_irt', spec: 'btc_irt' };
// rough IRR-based correlations (assumption, editable)
const CORR: number[][] = [
  [1, 0, 0, 0, 0, 0],
  [0, 1, 0.7, 0.4, 0.45, 0.4],
  [0, 0.7, 1, 0.35, 0.35, 0.3],
  [0, 0.4, 0.35, 1, 0.25, 0.25],
  [0, 0.45, 0.35, 0.25, 1, 0.8],
  [0, 0.4, 0.3, 0.25, 0.8, 1],
];
const H_DAYS: Record<PortfolioHorizon, number> = { m1: 30, m3: 90, m6: 180, y1: 365 };

export function buildPortfolios(risk: AssetRisk[], live: LiveBoard, coins: CryptoRow[]): Record<Profile, Record<PortfolioHorizon, Portfolio>> {
  const byKey = new Map(risk.map((r) => [r.key, r]));
  const fixedYield = Number(process.env.FIXED_INCOME_YIELD || 0.3);
  const out = {} as Record<Profile, Record<PortfolioHorizon, Portfolio>>;

  for (const profile of Object.keys(ANCHOR) as Profile[]) {
    out[profile] = {} as Record<PortfolioHorizon, Portfolio>;
    for (const horizon of Object.keys(H_DAYS) as PortfolioHorizon[]) {
      const base = ANCHOR[profile][horizon];
      const notes: string[] = [];
      const mult: number[] = [];
      const rationale: string[] = [];

      CLASSES.forEach((cls, i) => {
        const rk = RISK_KEY[cls];
        if (!rk) {
          mult.push(1);
          rationale.push(`بازده فرضی سالانه ${fmtPct(fixedYield * 100, 0, false)}؛ ضربه‌گیر نقدینگی`);
          return;
        }
        const hr = byKey.get(rk)?.horizons[horizon];
        if (!hr) {
          mult.push(0.9);
          rationale.push('داده ریسک کافی نیست؛ ۱۰٪ کاهش احتیاطی');
          return;
        }
        const buy = cls === 'spec' ? Math.min(100, hr.buy + 15) : hr.buy;
        let m = clamp(1 + (0.6 * (50 - buy)) / 50, 0.4, 1.6);
        if (hr.hold > 70) m *= 0.8;
        mult.push(m);
        rationale.push(`ریسک ورود ${fmtInt(buy)} · ریسک نگهداری ${fmtInt(hr.hold)} → ضریب ${fmtNum(m, 2)}`);
      });

      const w = CLASSES.map((cls, i) => (cls === 'cash' ? 0 : Math.min(base[i] * mult[i], CAP[profile][cls] ?? 1)));
      const riskySum = w.reduce((a, b) => a + b, 0);
      const maxRisky = 1 - CASH_MIN[profile];
      if (riskySum > maxRisky) for (let i = 1; i < w.length; i++) w[i] *= maxRisky / riskySum;
      const rounded = w.map((x) => Math.round(x * 100) / 100);
      rounded[0] = Math.round((1 - rounded.slice(1).reduce((a, b) => a + b, 0)) * 100) / 100;

      // portfolio vol (annual) with assumed correlations
      const vols = CLASSES.map((cls) => {
        const rk = RISK_KEY[cls];
        if (!rk) return 0.02;
        const v = byKey.get(rk)?.annualVolPct;
        return isNum(v) ? (v / 100) * (cls === 'spec' ? 1.8 : 1) : cls === 'equity' ? 0.3 : 0.5;
      });
      let variance = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) variance += rounded[i] * rounded[j] * vols[i] * vols[j] * CORR[i][j];
      const annualVolPct = Math.sqrt(variance) * 100;
      const varPct = 1.645 * annualVolPct * Math.sqrt(H_DAYS[horizon] / 365);

      const topCoins = coins.filter((c) => c.onNobitex !== false).slice(0, 3).map((c) => c.symbol).join('، ');
      const instrument: Record<Cls, string> = {
        cash: 'صندوق درآمد ثابت / سپرده کوتاه‌مدت',
        usd: isNum(live.usdtPremiumPct) && live.usdtPremiumPct > 3 ? `دلار اسکناس (پرمیوم تتر ${fmtPct(live.usdtPremiumPct)})` : 'تتر یا دلار اسکناس',
        gold:
          isNum(live.coinBubblePct) && live.coinBubblePct > 8
            ? `صندوق طلا یا طلای آب‌شده (حباب سکه ${fmtPct(live.coinBubblePct)})`
            : 'سکه امامی / صندوق طلا',
        equity: 'صندوق سهامی یا شاخصی + حداکثر یک‌پنجم از فهرست غربال سهام',
        btc: 'BTC و ETH (اولویت با BTC)',
        spec: topCoins ? `سقف این بخش؛ از فهرست غربال: ${topCoins}` : 'فقط از فهرست غربال کوین‌ها',
      };

      const lines: AllocationLine[] = CLASSES.map((cls, i) => ({
        cls,
        label: CLASS_LABEL[cls],
        weight: rounded[i],
        baseWeight: base[i],
        instrument: instrument[cls],
        rationale: rationale[i],
      }));

      if (rounded[0] > base[0] + 0.05) notes.push('ریسک‌های فعلی بالاتر از حد معمول است؛ سهم درآمد ثابت افزایش یافته.');
      if (rounded[0] < base[0] - 0.05) notes.push('ریسک ورود دارایی‌ها پایین‌تر از معمول است؛ سهم دارایی‌های پرنوسان کمی بیشتر شده.');
      notes.push('خرید را پلکانی (۳ تا ۴ مرحله) انجام دهید و در پایان بازه وزن‌ها را دوباره متعادل کنید.');

      out[profile][horizon] = { profile, horizon, lines, annualVolPct, varPct, notes };
    }
  }
  return out;
}
