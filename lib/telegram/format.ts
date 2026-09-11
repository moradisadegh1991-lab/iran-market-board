// Snapshot → Telegram HTML messages (each < 4000 chars)
import { fmtDateTimeFa, fmtInt, fmtPct, fmtPrice, isNum } from '@/lib/num';
import { HORIZONS, riskLevel } from '@/lib/engine/risk';
import { HORIZON_LABEL, PROFILE_LABEL } from '@/lib/engine/portfolio';
import type { Profile, Snapshot } from '@/lib/types';

const LIMIT = 3900;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DOT = ['🟢', '🟢', '🟡', '🟠', '🔴'];
const dot = (n: number | null | undefined) => (isNum(n) ? DOT[riskLevel(n)] : '⚪️');
const arrow = (p: number | null) => (!isNum(p) ? '' : p > 0 ? '🔺' : p < 0 ? '🔻' : '▫️');
const footer = (s: Snapshot) => `\n<i>🕒 ${fmtDateTimeFa(s.generatedAt)} · تحلیل الگوریتمی، توصیه سرمایه‌گذاری نیست</i>`;

function pack(header: string, blocks: string[], s: Snapshot): string[] {
  const out: string[] = [];
  let cur = header;
  for (const b of blocks) {
    if ((cur + '\n' + b + footer(s)).length > LIMIT) {
      out.push(cur + footer(s));
      cur = `${header} <i>(ادامه)</i>`;
    }
    cur += '\n' + b;
  }
  out.push(cur + footer(s));
  return out;
}

const unitTxt = (u: string) => (u === 'toman' ? ' تومان' : u === 'usd' ? ' $' : '');

export function pricesMsg(s: Snapshot): string[] {
  const lines = s.live.items.map(
    (it) =>
      `${arrow(it.changePct)} <b>${esc(it.label)}</b>: ${fmtPrice(it.price)}${unitTxt(it.unit)} (${fmtPct(it.changePct)})${it.note ? `\n     ↳ ${esc(it.note)}` : ''}`,
  );
  const bad = s.sources.filter((x) => !x.ok || x.stale).map((x) => x.label);
  if (bad.length) lines.push(`\n⚠️ منابع ناقص/قدیمی: ${esc(bad.join('، '))}`);
  return pack('💱 <b>قیمت لحظه‌ای بازارها</b>\n', lines, s);
}

export function riskMsg(s: Snapshot): string[] {
  const blocks = s.risk
    .filter((a) => !a.hidden)
    .map((a) => {
      const rows = HORIZONS.map((h) => {
        const r = a.horizons[h.key];
        if (!r) return `  ${h.label}: داده کافی نیست`;
        const conf = r.confidence < 0.6 ? ' ⁽کم‌اعتماد⁾' : '';
        return `  ${h.label}: خرید ${dot(r.buy)}${fmtInt(r.buy)} · نگهداری ${dot(r.hold)}${fmtInt(r.hold)} · فروش ${dot(r.sell)}${fmtInt(r.sell)}${conf}`;
      });
      return `\n<b>${esc(a.label)}</b>\n${rows.join('\n')}`;
    });
  return pack('⚠️ <b>ریسک خرید / نگهداری / فروش</b> (۰ کم ← ۱۰۰ زیاد)', blocks, s);
}

function cryptoBlocks(rows: Snapshot['crypto']['coins']) {
  return rows.map(
    (c) =>
      `${c.rank}. <b>${esc(c.symbol)}</b> ${fmtPrice(c.price)}$ · ۷روز ${fmtPct(c.m7, 0)} · امتیاز ${fmtInt(c.score)} · ریسک هفته ${dot(c.riskWeek)}${fmtInt(c.riskWeek)}${c.onNobitex ? ' · نوبیتکس✅' : ''}\n     ↳ ${esc(c.reasons.join('؛ '))}`,
  );
}

export const coinsMsg = (s: Snapshot) => pack('🪙 <b>۱۰ کوین با مومنتوم قوی (افق ۱ هفته)</b>', [...cryptoBlocks(s.crypto.coins), `\n<i>${esc(s.crypto.note)}</i>`], s);
export const memesMsg = (s: Snapshot) => pack('🐸 <b>۱۰ میم‌کوین با مومنتوم قوی (افق ۱ هفته)</b>', [...cryptoBlocks(s.crypto.memes), `\n<i>${esc(s.crypto.note)}</i>`], s);

export function stocksMsg(s: Snapshot): string[] {
  if (!s.stocks.rows.length) return pack('📈 <b>بورس و فرابورس</b>', [esc(s.stocks.note)], s);
  const blocks = s.stocks.rows.map(
    (r) =>
      `${r.rank}. <b>${esc(r.symbol)}</b> ${fmtInt(isNum(r.price) ? r.price : null)} ریال · امروز ${fmtPct(r.chgToday)}${isNum(r.r20) ? ` · ۲۰روز ${fmtPct(r.r20, 0)}` : ''} · امتیاز ${fmtInt(r.score)}${r.flags.length ? ` · ⚠️${esc(r.flags.join('، '))}` : ''}\n     ↳ ${esc(r.reasons.join('؛ '))}`,
  );
  return pack('📈 <b>۱۰ سهم مستعد رشد (افق ۱ ماه)</b>', [...blocks, `\n<i>${esc(s.stocks.note)}</i>`], s);
}

export function portfolioMsg(s: Snapshot, profile: Profile = s.defaultProfile): string[] {
  const blocks = (['m1', 'm3', 'm6', 'y1'] as const).map((h) => {
    const p = s.portfolios[profile][h];
    const lines = p.lines
      .filter((l) => l.weight > 0)
      .map((l) => `  • ${esc(l.label)}: <b>${fmtPct(l.weight * 100, 0, false)}</b> — ${esc(l.instrument)}`);
    return `\n<b>افق ${HORIZON_LABEL[h]}</b> · نوسان سالانه ${fmtPct(p.annualVolPct, 0, false)} · افت محتمل (۹۵٪) ${fmtPct(p.varPct, 0, false)}\n${lines.join('\n')}`;
  });
  blocks.push(`\n<i>${esc(s.portfolios[profile].m1.notes.slice(-1)[0] ?? '')}</i>`);
  return pack(`🧺 <b>سبد پیشنهادی — پروفایل ${PROFILE_LABEL[profile]}</b>`, blocks, s);
}

export function fullReport(s: Snapshot): string[] {
  return [...pricesMsg(s), ...riskMsg(s), ...coinsMsg(s), ...memesMsg(s), ...stocksMsg(s), ...portfolioMsg(s)];
}

