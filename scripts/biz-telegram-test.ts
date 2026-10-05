/**
 * The Telegram side of «فروشگاه آنلاین» end to end, with Telegram's API replaced by a recorder:
 * a business link, the menu → cart → order with a shared number, services → day → time → booking,
 * the owner's confirmation reaching the customer, and that the market bot's own /start still works.
 * Run: npx tsx scripts/biz-telegram-test.ts
 */
import assert from 'node:assert';
process.env.TELEGRAM_BOT_TOKEN = 'test:token';
process.env.TELEGRAM_BOT_USERNAME = 'MaliManBot';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

type Sent = { method: string; body: any };
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')) {
    sent.push({ method: u.split('/').pop()!, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }
  return realFetch(url, init);
}) as typeof fetch;

(async () => {
  const { emptyData } = await import('../lib/finance/model');
  const { addProduct, setupBusiness } = await import('../lib/biz/ops');
  const { catalogOf } = await import('../lib/biz/public');
  const { publish, pull, setRefStatus } = await import('../lib/biz/server');
  const { handleUpdate } = await import('../lib/telegram/handler');
  const { tellCustomer } = await import('../lib/telegram/biz');
  const { tehranParts } = await import('../lib/biz/slots');

  let n = 0;
  const ok = async (name: string, fn: () => Promise<void>) => {
    await fn();
    n++;
    console.log(`✓ ${name}`);
  };
  const now = Date.now();
  const today = tehranParts(now).date;
  const d = emptyData(today);
  setupBusiness(d, { name: 'کافه نارنج', type: 'cafe', card: 'none', now, today });
  const b = d.biz!;
  for (const h of b.hours) Object.assign(h, { open: true, from: '00:00', to: '23:45' });
  addProduct(b, { name: 'لاته', priceRial: 900_000, category: 'گرم' }, now);
  addProduct(b, { name: 'آیس‌تی', priceRial: 700_000, category: 'سرد' }, now);
  b.services.push({ id: 'class', name: 'کلاس باریستا', durationMin: 60, priceRial: 5_000_000, active: true });
  const token = 'x'.repeat(40);
  assert.ok((await publish('narenj', token, catalogOf(b, 'narenj', now, today), now)).ok);

  const CHAT = 777;
  const from = { id: CHAT, first_name: 'رضا' };
  const msg = (text: string) => handleUpdate({ message: { chat: { id: CHAT }, from, text } });
  const press = (data: string) => handleUpdate({ callback_query: { id: 'q', data, from, message: { chat: { id: CHAT }, message_id: 9 } } });
  const contact = () => handleUpdate({ message: { chat: { id: CHAT }, from, contact: { phone_number: '+989121234567', user_id: CHAT, first_name: 'رضا' } } });
  const last = (method = 'sendMessage') => [...sent].reverse().find((s) => s.method === method)!.body;
  const buttons = (body: any): { text: string; callback_data?: string; url?: string }[] => (body.reply_markup?.inline_keyboard ?? []).flat();

  await ok('a business link shows its card, with a link to its page', async () => {
    await msg('/start b_narenj');
    const m = last();
    assert.match(m.text, /کافه نارنج/);
    const bs = buttons(m);
    assert.ok(bs.some((x) => x.callback_data === 'bz:m') && bs.some((x) => x.callback_data === 'bz:b'));
    assert.ok(bs.some((x) => x.url?.endsWith('/shop?b=narenj')));
  });

  await ok('menu → category → add twice → cart → order with a shared number', async () => {
    await press('bz:m');
    assert.deepEqual(buttons(last()).filter((x) => x.callback_data?.startsWith('bz:c:')).map((x) => x.text), ['گرم', 'سرد']);
    await press('bz:c:0');
    const add = buttons(last()).find((x) => x.text.startsWith('لاته'))!;
    await press(add.callback_data!);
    await press(add.callback_data!);
    assert.match(last('answerCallbackQuery').text, /۲ قلم/);
    await press('bz:k');
    assert.match(last().text, /لاته × ۲: ۱۸۰٬۰۰۰ تومان/);
    await press('bz:o');
    assert.equal(last().reply_markup.keyboard[0][0].request_contact, true);
    await contact();
    const done = sent.filter((s) => s.method === 'sendMessage').slice(-2)[0].body;
    assert.match(done.text, /سفارش شما \(۱۸۰٬۰۰۰ تومان\) برای <b>کافه نارنج<\/b> ثبت شد/);
    const r = await pull('narenj', token, []);
    assert.ok(r.ok);
    const o = r.items.find((x) => x.kind === 'order')!;
    assert.deepEqual([o.via, o.name, o.phone, o.totalRial], ['telegram', 'رضا', '09121234567', 1_800_000]);
  });

  let bookingRef = '';
  await ok('services → day → time → booking', async () => {
    await press('bz:b');
    await press('bz:s:0');
    assert.ok(buttons(last('editMessageReplyMarkup')).some((x) => x.text.startsWith('✅ کلاس باریستا')));
    await press('bz:d');
    const day = buttons(last()).find((x) => x.callback_data?.startsWith('bz:D:'))!;
    await press(day.callback_data!);
    const time = buttons(last()).find((x) => x.callback_data?.startsWith('bz:T:'))!;
    await press(time.callback_data!);
    await contact();
    const r = await pull('narenj', token, []);
    assert.ok(r.ok);
    const bk = r.items.find((x) => x.kind === 'booking')!;
    assert.deepEqual([bk.serviceIds, bk.durationMin, bk.startsAt], [['class'], 60, +time.callback_data!.split(':')[2] * 60_000]);
    bookingRef = bk.id;
  });

  await ok('a shared number of someone else is refused', async () => {
    await press('bz:m');
    await press('bz:a:0');
    await press('bz:o');
    const before = sent.length;
    await handleUpdate({ message: { chat: { id: CHAT }, from, contact: { phone_number: '+989350000000', user_id: 999 } } });
    assert.match(sent.slice(before)[0].body.text, /فقط شماره خودتان/);
    await msg('انصراف');
    assert.equal(last().text, 'لغو شد.');
  });

  await ok('the owner confirms → the customer is told; «my orders» shows it', async () => {
    const r = await setRefStatus('narenj', token, bookingRef, 'confirmed');
    assert.ok(r.ok && r.chat === CHAT);
    await tellCustomer(r.chat!, 'کافه نارنج', bookingRef, 'booking', 'confirmed');
    assert.match(last().text, new RegExp(`نوبت <code>${bookingRef}</code> تأیید شد`));
    await press('bz:my');
    assert.match(last().text, /✅ تأیید شد/);
    assert.match(last().text, /⏳ منتظر تأیید/);
  });

  await ok('directory by city, and /shops', async () => {
    b.city = 'شیراز';
    await publish('narenj', token, catalogOf(b, 'narenj', now, today), now);
    await msg('/shops');
    const city = buttons(last()).find((x) => x.text === 'شیراز')!;
    await press(city.callback_data!);
    assert.ok(buttons(last()).some((x) => x.callback_data === 'bz:B:narenj'));
  });

  await ok('the market bot’s own /start still subscribes to the daily report', async () => {
    await msg('/start');
    assert.match(last().text, /ربات تابلوی بازار/);
  });

  console.log(`\n${n} telegram checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
