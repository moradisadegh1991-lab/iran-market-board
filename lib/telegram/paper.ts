// Telegram messages for live paper trading. Sent only to chats that opted in with /live_on <ADMIN_SECRET>.
import { kv } from '@/lib/store';
import { baseUrl } from '@/lib/auth';
import { fmtDateTimeFa, fmtInt, fmtPct, fmtPrice, isNum } from '@/lib/num';
import { PROFILES, SIM_ASSETS, type SimResult } from '@/lib/engine/simulator';
import type { LearnOutcome } from '@/lib/engine/learning';
import type { LiveSession, LiveTrade } from '@/lib/engine/live';
import { safeSend } from './api';

const NOTIFY_KEY = 'paper:notify';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LABEL = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a])) as Record<string, (typeof SIM_ASSETS)[number]>;
export const KIND_LABEL: Record<string, string> = { entry: 'ورود', add: 'افزایش موقعیت', trim: 'کاهش موقعیت', exit: 'خروج', stop: 'حد ضرر', take_profit: 'برداشت سود' };
const toman = (v: number) => `${fmtInt(v)} تومان`;

async function recipients(): Promise<string[]> {
  return kv.smembers(NOTIFY_KEY).catch(() => []);
}

async function sendAll(messages: string[]) {
  const chats = await recipients();
  for (const chat of chats) {
    const err = await safeSend(chat, messages);
    if (err && /blocked|chat not found|deactivated/i.test(err)) await kv.srem(NOTIFY_KEY, chat);
  }
}

export function tradeMessage(t: LiveTrade, s: LiveSession): string {
  const a = LABEL[t.asset];
  const buy = t.side === 'buy';
  const qty = t.qty >= 100 ? fmtInt(t.qty) : t.qty >= 1 ? t.qty.toLocaleString('fa-IR', { maximumFractionDigits: 3 }) : t.qty.toLocaleString('fa-IR', { maximumSignificantDigits: 4 });
  const lines = [
    `${buy ? '🟢 خرید' : t.kind === 'stop' ? '🛑 فروش (حد ضرر)' : '🔴 فروش'} · <b>${esc(a.label)}</b> · ${KIND_LABEL[t.kind] ?? t.kind}`,
    `مقدار: ${qty} ${esc(a.unit)}${t.asset === 'tse' ? ' (واحد معادل شاخص)' : ''}`,
    `قیمت اجرا: ${fmtPrice(t.price / 10)} تومان`,
    `ارزش معامله: ${toman(t.valueToman)} · کارمزد و اسپرد: ${toman(t.feeToman)}`,
  ];
  if (!buy && isNum(t.realizedToman)) {
    lines.push(`${t.realizedToman >= 0 ? '✅ سود' : '❌ زیان'} تحقق‌یافته: ${toman(Math.abs(t.realizedToman))} (${fmtPct(t.realizedPct, 1)})${isNum(t.holdDays) ? ` پس از ${fmtInt(t.holdDays)} روز` : ''}`);
  }
  lines.push(`وزن ${esc(a.label)} در سبد پس از معامله: ${fmtPct(t.weightAfter * 100, 0, false)}`);
  lines.push('', '<b>دلیل:</b>', ...t.reasons.slice(0, 3).map((r) => `• ${esc(r)}`));
  if (t.news.length) lines.push(`📰 ${esc(t.news[0].source)}: ${esc(t.news[0].title.slice(0, 120))}`);
  lines.push('', `📊 ارزش سبد: ${toman(t.equityToman)} (${fmtPct(t.returnPct, 2)})`, `🕒 ${fmtDateTimeFa(t.at)} · معامله شماره ${fmtInt(t.n)}`);
  const left = s.endsAt - t.at;
  if (left > 0) lines.push(`⏳ ${fmtInt(Math.ceil(left / 86400000))} روز تا پایان`);
  lines.push('<i>معامله کاغذی روی قیمت واقعی؛ پول واقعی جابه‌جا نشده است.</i>');
  return lines.join('\n');
}

export async function notifyTrades(s: LiveSession, trades: LiveTrade[]) {
  if (!trades.length) return;
  await sendAll(trades.map((t) => tradeMessage(t, s)));
}

export async function notifyStart(s: LiveSession) {
  const c = s.config;
  await sendAll([
    [
      '▶️ <b>معامله برخط شروع شد</b>',
      `سرمایه: ${toman(c.capitalToman)}`,
      `پروفایل: ${PROFILES[c.profile].label} · مدت: ${fmtInt(c.days)} روز · بازبینی ${c.reviewEveryDays === 1 ? 'روزانه' : 'هفتگی'}`,
      `دارایی‌ها: ${c.assets.map((a) => LABEL[a].label).join('، ')}`,
      `موتور: نسخه ${fmtInt(s.params.version)}${s.params.version === 0 ? ' (قواعد پایه)' : ' (آموخته از اجراهای قبلی)'}`,
      `پایان: ${fmtDateTimeFa(s.endsAt)}`,
      '',
      'هر معامله همین‌جا اطلاع داده می‌شود. پایان زودتر: /live_stop',
    ].join('\n'),
  ]);
}

export function statusMessage(s: LiveSession | null): string {
  if (!s || s.status !== 'running') return 'معامله برخط فعالی وجود ندارد. شروع از صفحه «معامله برخط» در داشبورد:\n' + `${baseUrl()}/live`;
  const last = s.equity[s.equity.length - 1];
  const eq = last?.equity ?? s.config.capitalToman;
  const held = Object.entries(s.positions).filter(([, p]) => p && p.qty > 0);
  return [
    '📈 <b>وضعیت معامله برخط</b>',
    `ارزش سبد: ${toman(eq)} (${fmtPct((eq / s.config.capitalToman - 1) * 100, 2)})`,
    `نقد: ${toman(last?.cash ?? s.acct.cash / 10)}`,
    held.length ? `موقعیت‌ها: ${held.map(([a]) => LABEL[a].label).join('، ')}` : 'موقعیت بازی وجود ندارد.',
    `معاملات: ${fmtInt(s.trades.length)} · آخرین بررسی: ${fmtDateTimeFa(s.lastTickAt)}`,
    `پایان: ${fmtDateTimeFa(s.endsAt)}`,
    `${baseUrl()}/live`,
  ].join('\n');
}

export async function notifyFinish(s: LiveSession, r: SimResult, learning: LearnOutcome | null) {
  const m = r.metrics;
  const dep = r.benchmarks.find((b) => b.key === 'deposit');
  const best = [...r.benchmarks].filter((b) => b.key !== 'strategy').sort((a, b) => b.returnPct - a.returnPct)[0];
  const lines = [
    `🏁 <b>معامله برخط پایان یافت</b> (${s.endReason === 'stopped' ? 'به دستور کاربر' : 'پایان مدت'})`,
    `سرمایه اولیه: ${toman(m.startEquity)}`,
    `ارزش نهایی: ${toman(m.finalEquity)}`,
    `${m.pnlToman >= 0 ? '✅ سود' : '❌ زیان'}: ${toman(Math.abs(m.pnlToman))} (${fmtPct(m.returnPct, 2)})`,
    dep ? `سپرده بدون ریسک در همین مدت: ${fmtPct(dep.returnPct, 2)}` : '',
    best ? `بهترین گزینه منفعل: ${esc(best.label)} ${fmtPct(best.returnPct, 2)}` : '',
    `معاملات: ${fmtInt(m.trades)} · حد ضرر: ${fmtInt(m.stops)} · بیشترین افت: ${fmtPct(m.maxDrawdownPct, 1)}`,
    isNum(m.winRatePct) ? `فروش‌های سودده: ${fmtPct(m.winRatePct, 0, false)}` : '',
    `کارمزد: ${toman(m.feesToman)} · سود نقد: ${toman(m.interestToman)}`,
  ].filter(Boolean);
  if (learning) {
    lines.push('', learning.applied ? `🧠 موتور به نسخه ${fmtInt(learning.after.version)} به‌روز شد.` : `🧠 موتور تغییر نکرد: ${esc(learning.reason ?? '')}`);
    for (const l of learning.lessons.slice(0, 3)) lines.push(`• ${esc(l.title)}${l.change ? ` ← ${esc(l.change)}` : ''}`);
  }
  lines.push('', `گزارش کامل: ${baseUrl()}/live`, '<i>موقعیت‌های باز با قیمت روز ارزش‌گذاری شده‌اند. این نتیجه توصیه سرمایه‌گذاری نیست.</i>');
  await sendAll([lines.join('\n')]);
}
