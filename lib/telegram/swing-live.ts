// Telegram messages for live swing trading. Reuses the same opt-in list as the live paper trader
// (/live_on <ADMIN_SECRET>), so a user who already gets trade alerts gets these too.
import { kv } from '@/lib/store';
import { baseUrl } from '@/lib/auth';
import { fmtDateTimeFa, fmtInt, fmtPct, fmtPrice, isNum } from '@/lib/num';
import { SWING_EXIT_LABEL } from '@/lib/engine/swing';
import type { SwingLiveFill, SwingLiveSession } from '@/lib/engine/swing-live';
import { safeSend } from './api';

const NOTIFY_KEY = 'paper:notify';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toman = (v: number) => `${fmtInt(v)} تومان`;

async function sendAll(messages: string[]) {
  const chats = await kv.smembers(NOTIFY_KEY).catch(() => [] as string[]);
  for (const chat of chats) {
    const err = await safeSend(chat, messages);
    if (err && /blocked|chat not found|deactivated/i.test(err)) await kv.srem(NOTIFY_KEY, chat);
  }
}

function qtyText(q: number): string {
  return q >= 100 ? fmtInt(q) : q >= 1 ? q.toLocaleString('fa-IR', { maximumFractionDigits: 3 }) : q.toLocaleString('fa-IR', { maximumSignificantDigits: 4 });
}

/** One completed round trip — swing fills always report entry and exit together. */
export function swingFillMessage(f: SwingLiveFill): string {
  const win = f.pnlToman >= 0;
  return [
    `${win ? '✅' : '❌'} <b>${esc(f.symbol)}</b> · معامله بسته شد · ${esc(SWING_EXIT_LABEL[f.exit] ?? f.exit)}`,
    `ورود ${fmtPrice(f.entryPrice)} → خروج ${fmtPrice(f.exitPrice)} (${fmtPct(f.netPct, 2)})`,
    `مقدار: ${qtyText(f.qty)} · نگهداری ${fmtInt(f.holdH)} کندل`,
    `${win ? 'سود' : 'زیان'}: ${toman(Math.abs(f.pnlToman))} · کارمزد: ${toman(f.feeToman)}`,
    `<i>${esc(f.entryReason)}</i>`,
  ].join('\n');
}

export async function notifySwingFills(fills: SwingLiveFill[], s: SwingLiveSession) {
  if (!fills.length) return;
  const head = `📈 <b>نوسان‌گیری برخط</b> · ${fmtInt(fills.length)} معامله تازه`;
  await sendAll([[head, ...fills.map(swingFillMessage)].join('\n\n')]);
}

export async function notifySwingStart(s: SwingLiveSession) {
  await sendAll([
    [
      '📈 <b>نوسان‌گیری برخط شروع شد</b>',
      `سرمایه: ${toman(s.config.capitalToman)} روی ${fmtInt(s.config.coins.length)} ارز`,
      `ارزها: ${esc(s.config.coins.map((c) => c.symbol).join('، '))}`,
      `مدت: ${fmtInt(s.config.hours)} ساعت · کندل ${fmtInt(s.barMinutes)} دقیقه‌ای`,
      `پایان: ${fmtDateTimeFa(s.endsAt)}`,
      '',
      `${baseUrl()}/swing`,
      '<i>معامله کاغذی روی قیمت واقعی است؛ پول واقعی جابه‌جا نمی‌شود.</i>',
    ].join('\n'),
  ]);
}

export async function notifySwingFinish(s: SwingLiveSession) {
  const last = s.equity[s.equity.length - 1]?.equity ?? s.config.capitalToman;
  const retPct = (last / s.config.capitalToman - 1) * 100;
  const wins = s.fills.filter((f) => f.pnlToman > 0).length;
  const lines = [
    `🏁 <b>پایان نوسان‌گیری برخط</b> (${s.endReason === 'stopped' ? 'به دستور کاربر' : 'پایان مدت'})`,
    `ارزش نهایی: ${toman(last)} (${fmtPct(retPct, 2)})`,
    `معاملات: ${fmtInt(s.fills.length)}${s.fills.length ? ` · ${fmtPct((wins / s.fills.length) * 100, 0, false)} برد` : ''}`,
  ];
  if (s.open.length) lines.push(`موقعیت‌های باز در لحظه پایان: ${esc(s.open.map((o) => o.symbol).join('، '))}`);
  const best = [...s.fills].sort((a, b) => b.netPct - a.netPct)[0];
  const worst = [...s.fills].sort((a, b) => a.netPct - b.netPct)[0];
  if (best && isNum(best.netPct)) lines.push(`بهترین: ${esc(best.symbol)} ${fmtPct(best.netPct, 1)}`);
  if (worst && worst !== best) lines.push(`ضعیف‌ترین: ${esc(worst.symbol)} ${fmtPct(worst.netPct, 1)}`);
  lines.push('', `${baseUrl()}/swing`, '<i>نتیجه گذشته تضمینی برای آینده نیست.</i>');
  await sendAll([lines.join('\n')]);
}
