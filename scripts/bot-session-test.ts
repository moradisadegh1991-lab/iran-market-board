import assert from 'node:assert/strict';
import { botSessionAction } from '../lib/bot-session';
import { callFutures, FUT_KEY } from '../lib/futures-local';
const data = new Map<string, string>();
let fail = false;
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { if (fail) throw new Error('quota'); data.set(k, v); } },
  window: { dispatchEvent() {} },
});
let n = 0;
async function test(name: string, fn: () => Promise<void>) { data.clear(); fail = false; await fn(); console.log(`✓ ${name}`); n++; }
async function main() {
  await test('simultaneous actions on the same bot are refused; lock releases after success', async () => {
    let release!: () => void;
    const first = botSessionAction('bot', undefined, async (save) => { await new Promise<void>((r) => { release = r; }); save({ id: 'one' }); });
    await assert.rejects(botSessionAction('bot', undefined, async () => {}), /پردازش/);
    release(); await first;
    await botSessionAction('bot', { id: 'one' }, async (save) => save({ id: 'two' }));
    assert.equal(JSON.parse(data.get('bot')!).id, 'two');
  });
  await test('a stale caller is rejected before making a request', async () => {
    data.set('bot', JSON.stringify({ id: 'new' }));
    let called = false;
    await assert.rejects(botSessionAction('bot', { id: 'old' }, async () => { called = true; }), /تغییر/);
    assert.equal(called, false);
  });
  await test('a concurrent storage edit cannot be overwritten by an old response', async () => {
    await assert.rejects(botSessionAction('bot', undefined, async (save) => {
      data.set('bot', JSON.stringify({ id: 'other-tab' }));
      save({ id: 'late-response' });
    }), /پاسخ قدیمی/);
    assert.equal(JSON.parse(data.get('bot')!).id, 'other-tab');
  });
  await test('storage failure is visible and a later action can recover', async () => {
    fail = true;
    await assert.rejects(botSessionAction('bot', undefined, async (save) => save({ id: 'one' })), /ذخیره نشد/);
    fail = false;
    await botSessionAction('bot', undefined, async (save) => save({ id: 'two' }));
  });
  await test('invalid responses leave the prior session intact', async () => {
    data.set(FUT_KEY, JSON.stringify({ v: 1, id: 'old' }));
    Object.assign(globalThis, { fetch: async () => ({ ok: true, json: async () => ({ account: null }) }) });
    await assert.rejects(callFutures(null, { action: 'create', capital: 100 }), /معتبر نیست/);
    assert.equal(JSON.parse(data.get(FUT_KEY)!).id, 'old');
  });
  await test('futures response persists exactly once and returns only after persistence', async () => {
    const account = { v: 1, id: 'new', wallet: 100, positions: [] };
    Object.assign(globalThis, { fetch: async () => ({ ok: true, json: async () => ({ account, newFills: [] }) }) });
    const r = await callFutures(null, { action: 'create', capital: 100 });
    assert.deepEqual(r.account, account);
    assert.deepEqual(JSON.parse(data.get(FUT_KEY)!), account);
  });
  console.log(`${n} bot session tests passed`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
