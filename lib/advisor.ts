// مشاور مالی — the server half. Builds the Claude request from the numbers-only summary the
// browser/app sends plus today's market board, and validates everything that comes in, because
// this is the one route that spends money (the Anthropic key in Vercel) on every call.
import type Anthropic from '@anthropic-ai/sdk';
import type { Snapshot } from '@/lib/types';
import { isNum } from '@/lib/num';

export const ADVISOR_MODEL = process.env.ADVISOR_MODEL || 'claude-opus-5-5';
export const MAX_TURNS = 20;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_SUMMARY_CHARS = 40_000;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdvisorRequest {
  summary: unknown;
  messages: ChatTurn[];
}

/** Throws a Persian message on anything malformed; returns the cleaned request otherwise. */
export function validateAdvisorRequest(body: unknown): AdvisorRequest {
  if (!body || typeof body !== 'object') throw new Error('بدنه درخواست نامعتبر است.');
  const b = body as Record<string, unknown>;
  const msgs = Array.isArray(b.messages) ? b.messages : null;
  if (!msgs || !msgs.length) throw new Error('هیچ پیامی فرستاده نشده.');
  if (msgs.length > MAX_TURNS) throw new Error(`گفت‌وگو بیش از ${MAX_TURNS} پیام شده؛ یک گفت‌وگوی تازه شروع کنید.`);
  const messages: ChatTurn[] = msgs.map((m, i) => {
    const role = (m as ChatTurn)?.role;
    const content = String((m as ChatTurn)?.content ?? '').trim();
    if (role !== (i % 2 === 0 ? 'user' : 'assistant')) throw new Error('ترتیب پیام‌ها نامعتبر است (باید کاربر/مشاور یکی‌درمیان باشد).');
    if (!content) throw new Error('پیام خالی است.');
    if (content.length > MAX_MESSAGE_CHARS) throw new Error(`هر پیام حداکثر ${MAX_MESSAGE_CHARS.toLocaleString('fa-IR')} نویسه.`);
    return { role, content };
  });
  if (messages[messages.length - 1].role !== 'user') throw new Error('آخرین پیام باید از طرف کاربر باشد.');
  const summaryText = JSON.stringify(b.summary ?? null);
  if (summaryText.length > MAX_SUMMARY_CHARS) throw new Error('خلاصه مالی بیش از حد بزرگ است.');
  return { summary: b.summary ?? null, messages };
}

/** The slice of today's board that matters for personal decisions, in toman. */
export function marketContext(snap: Snapshot | null, fixedIncomeYieldPct: number) {
  if (!snap) return { available: false, fixedIncomeYieldPct };
  const pick = (k: string) => snap.live.items.find((x) => x.key === k);
  const price = (k: string) => {
    const it = pick(k);
    return it && isNum(it.price) ? { label: it.label, price: Math.round(it.price), unit: it.unit === 'toman' ? 'تومان' : it.unit === 'usd' ? 'دلار' : 'واحد', change24hPct: isNum(it.changePct) ? +it.changePct.toFixed(2) : null } : null;
  };
  const scen = (k: string) => {
    const a = snap.scenarios.assets.find((x) => x.key === k);
    const y = a?.rows.y1;
    return y ? { label: a!.label, oneYearWorstPct: Math.round(y.worstPct), oneYearBasePct: Math.round(y.basePct), oneYearBestPct: Math.round(y.bestPct) } : null;
  };
  return {
    available: true,
    asOf: snap.generatedAt,
    fixedIncomeYieldPct,
    prices: ['usd', 'usdt', 'g18', 'coin', 'nim', 'rob', 'silver', 'btc', 'tse'].map(price).filter(Boolean),
    bubbles: { coinPct: snap.live.coinBubblePct, g18Pct: snap.live.g18BubblePct, usdtPremiumPct: snap.live.usdtPremiumPct },
    oneYearScenarios: ['usd', 'g18', 'coin', 'btc', 'tse'].map(scen).filter(Boolean),
  };
}

export const SYSTEM_PROMPT = `You are «مشاور مالی», a personal-finance advisor inside an Iranian personal-finance app. Always answer in Persian (Farsi).

Who you are talking to: one Iranian individual managing their household money. You receive (1) a JSON summary of their finances computed by the app — every amount is in toman — and (2) today's Iranian market board. Use only these numbers plus what the user tells you. Never invent balances, prices, rates or events. If a decision needs a number you don't have (income stability, family size, a loan's penalty terms…), say which number is missing and either ask for it or answer conditionally ("اگر … باشد، …").

How to think about money in Iran:
- Inflation is high (the user's own expected rate is in settings.expectedInflationPct). A choice has to be judged in real terms. A fixed-income fund (settings.fixedIncomeYieldPct, roughly the safe rate) is the hurdle every other option must beat after risk — a positive nominal return proves nothing on its own.
- The rial tends to weaken in steps, not smoothly. Gold, coin and dollar are hedges, but coins carry a bubble over melt value, and buy/sell spreads plus wage (اجرت) on jewelry are real costs. Mention these when relevant.
- Loans: Iranian bank loans use equal monthly installments. Compare a loan's rate with expected inflation and with the user's debt-service ratio. Treat installments over ~35–40% of income as dangerous.
- Cheques: a bounced cheque (چک برگشتی) has legal and credit consequences in the Sayad system. If next30Days.lowestCashToman is negative, raise it first.
- Emergency fund: compare health.emergencyMonthsCovered with settings.emergencyTargetMonths before recommending any risky investment.
- Diversification across gold, dollar and crypto in Iran is weaker than it looks: they mostly move together on rial weakness.

How to answer:
- Lead with a direct answer or recommendation in one or two sentences, then the reasoning with the user's own numbers.
- For a decision between options, compare them in a short Markdown table (cost, risk, liquidity, real return), then say which you would pick for this user and what would change your mind.
- Be concrete: amounts in toman with Persian digits and a unit (e.g. «۲۵ میلیون تومان»), dates in the Jalali calendar.
- Keep it short: usually under 250 words unless the user asks for a full plan. Use light Markdown only (bold, short lists, at most one table).
- You are not a licensed advisor and cannot know the future. Do not promise returns. Name the main risk of whatever you recommend. Never suggest anything illegal (tax evasion, unlicensed FX dealing, hiding assets in a divorce or mehrieh case).
- If the summary shows no data yet (all zeros), help the user decide what to record first instead of giving generic advice.

Measured facts you may cite (real TGJU / Binance data, measured by this app in Mehr 1405; annualised, before tax):
- Holding 18k gold or the Emami coin: about +56%/yr in 2015–2020 and +71%/yr in 2021–2026; the free-market dollar +44% and +49%. A fixed-income fund paid roughly 20% then 27%. Holding beat every timing rule the app tested (moving-average exits) in both periods, because the rial's decline is persistent.
- The price of that return: worst falls of −38% to −48% (2015–2020) and −24% to −31% (2021–2026), with up to 1–2 years below a previous peak. Money needed within a year does not belong there.
- Iran news sentiment did not predict the next weeks' prices in a stable way (the sign flipped from year to year): by the time a headline is out, the market has usually moved.
- Crypto: every hourly swing-trading variant lost money after a 0.8% round-trip cost (2023–2026). A daily trend filter (hold only while the coin and BTC are above their 50-day average) was the only approach that was positive, and it still had drawdowns of about −20% to −50%.`;

/** First user turn carries the data; later turns are the plain conversation. */
export function buildMessages(req: AdvisorRequest, market: unknown): Anthropic.Beta.BetaMessageParam[] {
  const data =
    `<financial_summary>\n${JSON.stringify(req.summary)}\n</financial_summary>\n` +
    `<market_today>\n${JSON.stringify(market)}\n</market_today>`;
  return req.messages.map((m, i) =>
    i === 0
      ? { role: 'user', content: [{ type: 'text', text: data }, { type: 'text', text: m.content }] }
      : { role: m.role, content: m.content },
  );
}

/** Whoever holds the secret may spend the key. ADVISOR_SECRET if set, otherwise ADMIN_SECRET. */
export function advisorSecret(): string | null {
  return process.env.ADVISOR_SECRET || process.env.ADMIN_SECRET || null;
}
