/**
 * «فیوچرز من» — the paper futures account of a device (rule 95, the rule-13 pattern). Stateless: the device
 * posts its account, the server walks it through the candles since its last look (liquidation, stop,
 * target, funding — lib/engine/futures-account.ts), applies the requested order, and hands it back. Nothing
 * is stored; no order ever reaches an exchange.
 * POST { action: 'create', capital } | { action: 'tick'|'open'|'close'|'auto'|'autoNow', account, order?, posId?, auto? }
 */
import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { gatherFutures, lastPrices } from '@/lib/futures-data';
import { autoDecide, closeOrder, createAccount, futuresTick, openOrder, saneAccount, setAuto, type FuturesAccount } from '@/lib/engine/futures-account';
import { PICK_UNIVERSE } from '@/lib/engine/coin-pick';
import { isNum } from '@/lib/num';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const MAX_BODY = 1_500_000;
const KNOWN = new Set(PICK_UNIVERSE.map((c) => c.sym));

function reply(account: FuturesAccount, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ account, ...extra }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new Error('حجم حساب بیش از حد مجاز است.');
    const body = JSON.parse(text || '{}');
    const action = String(body?.action ?? '');
    const now = Date.now();
    if (action === 'create') return reply(createAccount(Number(body?.capital), now));

    let a = saneAccount(body?.account);
    const order = body?.order;
    const extra: string[] = [];
    if (action === 'open') {
      const sym = String(order?.sym ?? '').toUpperCase();
      if (!KNOWN.has(sym)) throw new Error('این ارز در فهرست فیوچرز نیست.');
      extra.push(sym);
    }
    if (action === 'auto' && body?.auto) for (const c of body.auto.coins ?? []) if (!KNOWN.has(String(c).toUpperCase())) throw new Error(`ارز ${String(c)} در فهرست نیست.`);
    // every action first brings the account up to now, so an order never jumps over a liquidation
    const g = await gatherFutures(a, extra, now);
    const t = futuresTick(a, g.data, g.btcDaily, now);
    a = t.account;
    for (const note of g.notes.slice(0, 3)) if (!a.events.slice(0, 6).some((e) => e.text === note)) a.events.unshift({ at: now, kind: 'data', text: note });

    if (action === 'open') {
      const sym = String(order.sym).toUpperCase();
      const price = g.data[sym]?.last ?? (await lastPrices([sym]))[sym];
      if (!price) throw new Error(`قیمت لحظه‌ای ${sym} در دسترس نیست؛ کمی بعد دوباره امتحان کنید.`);
      a = openOrder(a, { sym, side: order.side === 'short' ? 'short' : 'long', lev: Number(order.lev), margin: Number(order.margin), tp: isNum(+order.tp) && +order.tp > 0 ? +order.tp : null, sl: isNum(+order.sl) && +order.sl > 0 ? +order.sl : null }, price, now);
    } else if (action === 'close') {
      const p = a.positions.find((x) => x.id === String(body?.posId));
      if (!p) throw new Error('این موقعیت دیگر باز نیست (شاید به حد سود، حد ضرر یا لیکویید رسیده باشد).');
      const price = g.data[p.sym]?.last;
      if (!price) throw new Error(`قیمت لحظه‌ای ${p.sym} در دسترس نیست.`);
      a = closeOrder(a, p.id, price, now);
    } else if (action === 'auto') {
      a = setAuto(a, body?.auto ? { coins: (body.auto.coins ?? []).map(String), lev: Number(body.auto.lev) || 1, mode: body.auto.mode } : null, now);
    } else if (action === 'autoNow') {
      if (!a.auto) throw new Error('روندسوار با اهرم روشن نیست.');
      const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
      autoDecide(a, dayStart, g.data, g.btcDaily, (sym) => g.data[sym]?.last ?? null, now);
      a.autoDay = dayStart;
    } else if (action !== 'tick') {
      throw new Error('action نامعتبر است.');
    }
    return reply(a, { newFills: t.newFills });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
